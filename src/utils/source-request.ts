import axios, { AxiosError, AxiosResponse } from 'axios';
import { Response } from 'express';

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function getSourcePage(url: string): Promise<AxiosResponse> {
    let lastError: unknown;

    // Retry only temporary upstream/network failures. A 403 is reported immediately:
    // repeating a blocked request does not make it accessible.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const origin = new URL(url).origin;
            return await axios.get(url, {
                timeout: 25000,
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
        } catch (error) {
            lastError = error;
            const status = axios.isAxiosError(error)
                ? error.response?.status
                : undefined;
            const retryable =
                !status || status === 408 || status === 429 || status >= 500;
            if (!retryable || attempt === 3) break;
            await new Promise((resolve) => setTimeout(resolve, attempt * 700));
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
        : undefined;
    const rawBody = axios.isAxiosError(error)
        ? axiosError.response?.data
        : undefined;
    const body =
        typeof rawBody === 'string'
            ? rawBody.replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 500)
            : undefined;

    console.error('[source-request]', {
        source,
        status: status ?? null,
        code: axios.isAxiosError(error) ? axiosError.code : null,
        message: error instanceof Error ? error.message : String(error),
        body,
    });

    res.status(502).json({
        error: 'UPSTREAM_SOURCE_ERROR',
        message:
            status === 403
                ? 'Sumber menolak koneksi server (HTTP 403).'
                : status
                  ? `Sumber gagal merespons (HTTP ${status}).`
                  : 'Server gagal menghubungi sumber data.',
        source,
        upstreamStatus: status ?? null,
        details: body || undefined,
    });
}
