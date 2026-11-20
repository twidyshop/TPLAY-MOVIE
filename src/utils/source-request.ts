import axios, { AxiosError, AxiosResponse } from 'axios';
import { Response } from 'express';

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SCRAPINGBEE_ENDPOINT = 'https://app.scrapingbee.com/api/v1';
const DIRECT_TIMEOUT = 18000;
const PROXY_TIMEOUT = 25000;

function isCloudflareChallenge(data: unknown): boolean {
    if (typeof data !== 'string') return false;
    return /just a moment|enable javascript and cookies|checking your browser|cf-browser-verification|challenge-platform/i.test(
        data.slice(0, 30000)
    );
}

async function fetchWithScrapingBee(url: string): Promise<AxiosResponse> {
    const apiKey = process.env.SCRAPINGBEE_API_KEY;
    if (!apiKey) {
        throw new Error(
            'Sumber menolak koneksi langsung (HTTP 403). SCRAPINGBEE_API_KEY belum dipasang di environment Vercel.'
        );
    }

    // Auto mode escalates through stealth proxy when required (75 credits on success).
    // The caller explicitly approved this maximum to prioritize successful fetching.
    const response = await axios.get<string>(SCRAPINGBEE_ENDPOINT, {
        params: {
            url,
            mode: 'auto',
            max_cost: 75,
            block_resources: true,
            wait_browser: 'domcontentloaded',
        },
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'text/html,application/xhtml+xml',
        },
        timeout: PROXY_TIMEOUT,
        maxRedirects: 3,
        responseType: 'text',
        transformResponse: [(data) => data],
        validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
        const error = new Error(
            `ScrapingBee mengembalikan HTTP ${response.status}`
        ) as Error & { response?: { status: number; data: unknown }; requestUrl?: string };
        error.requestUrl = url;
        error.response = {
            status: response.status,
            data: typeof response.data === 'string'
                ? response.data.slice(0, 1200)
                : response.data,
        };
        throw error;
    }

    if (isCloudflareChallenge(response.data)) {
        const error = new Error(
            'Tantangan Cloudflare masih belum dapat diselesaikan oleh layanan fetch eksternal.'
        ) as Error & { response?: { status: number; data: unknown } };
        error.response = { status: 403, data: 'Cloudflare challenge masih aktif setelah proxy.' };
        throw error;
    }

    return response;
}

/**
 * Fetch source HTML directly first. If the source returns a Cloudflare
 * challenge, retry through ScrapingBee when SCRAPINGBEE_API_KEY is configured.
 * The original LK21_URL / ND_URL are never rewritten.
 */
export async function getSourcePage(url: string): Promise<AxiosResponse> {
    // LK21_URL in Vercel may include a trailing slash. Controllers append
    // paths with `/`, so collapse duplicate path slashes before requesting.
    // Keep the protocol separator and query string intact.
    const parsedUrl = new URL(url);
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/{2,}/g, '/');
    const sourceUrl = parsedUrl.toString();
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const origin = new URL(sourceUrl).origin;
            const response = await axios.get<string>(sourceUrl, {
                timeout: DIRECT_TIMEOUT,
                maxRedirects: 5,
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Cache-Control': 'no-cache',
                    Pragma: 'no-cache',
                    Referer: origin + '/',
                    Origin: origin,
                },
            });

            if (!isCloudflareChallenge(response.data)) return response;
            lastError = new Error('Sumber mengembalikan halaman tantangan Cloudflare.');
            break;
        } catch (error) {
            lastError = error;
            const status = axios.isAxiosError(error)
                ? error.response?.status
                : (error as any)?.response?.status;
            const retryable =
                !status || status === 408 || status === 429 || status >= 500;
            if (status === 403) break;
            if (!retryable || attempt === 3) break;
            await new Promise((resolve) => setTimeout(resolve, attempt * 700));
        }
    }

    const status = axios.isAxiosError(lastError)
        ? lastError.response?.status
        : (lastError as any)?.response?.status;
    const errorCode = axios.isAxiosError(lastError) ? lastError.code : (lastError as any)?.code;
    const tlsCertificateError = [
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'CERT_HAS_EXPIRED',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
    ].includes(String(errorCode));
    const needsProxy =
        status === 403 ||
        tlsCertificateError ||
        (axios.isAxiosError(lastError) &&
            isCloudflareChallenge(lastError.response?.data)) ||
        (lastError instanceof Error &&
            /cloudflare|challenge/i.test(lastError.message));

    if (needsProxy) {
        if (!process.env.SCRAPINGBEE_API_KEY) {
            throw new Error(
                'Koneksi langsung ke sumber gagal atau diblokir. Tambahkan SCRAPINGBEE_API_KEY di Vercel agar fallback proxy aktif.'
            );
        }
        try {
            return await fetchWithScrapingBee(sourceUrl);
        } catch (proxyError) {
            console.error('[source-request] external fetch failed', {
                requestUrl: (proxyError as any)?.requestUrl ?? sourceUrl,
                message: proxyError instanceof Error
                    ? proxyError.message
                    : String(proxyError),
                status: axios.isAxiosError(proxyError)
                    ? proxyError.response?.status
                    : (proxyError as any)?.response?.status ?? null,
            });
            throw proxyError;
        }
    }

    throw lastError;
}

export function respondSourceError(
    res: Response,
    error: unknown,
    source: string
): void {
    const axiosError = error as AxiosError;
    const status = axios.isAxiosError(error)
        ? axiosError.response?.status
        : (error as any)?.response?.status;
    const rawBody = axios.isAxiosError(error)
        ? axiosError.response?.data
        : (error as any)?.response?.data;
    const body =
        typeof rawBody === 'string'
            ? rawBody.replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 500)
            : undefined;

    console.error('[source-request]', {
        requestUrl: (error as any)?.requestUrl ?? null,
        source,
        status: status ?? null,
        code: axios.isAxiosError(error) ? axiosError.code : null,
        message: error instanceof Error ? error.message : String(error),
        body,
    });

    const message =
        error instanceof Error &&
        error.message.includes('SCRAPINGBEE_API_KEY')
            ? error.message
            : status === 401 || status === 403
              ? 'Layanan proxy menolak autentikasi atau sumber masih diblokir. Periksa SCRAPINGBEE_API_KEY dan status layanan.'
              : status
                ? `Sumber gagal merespons (HTTP ${status}).`
                : error instanceof Error &&
                    /cloudflare|challenge/i.test(error.message)
                  ? error.message
                  : 'Server gagal menghubungi sumber data.';

    res.status(502).json({
        error: 'UPSTREAM_SOURCE_ERROR',
        message,
        source,
        upstreamStatus: status ?? null,
        details: body || undefined,
    });
}
