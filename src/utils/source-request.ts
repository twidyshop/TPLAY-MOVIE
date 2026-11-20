import { AxiosError, AxiosResponse } from 'axios';
import { Response } from 'express';

// Chromium 153 + Puppeteer 25.11 are deliberately pinned as a compatible pair.
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

let browserPromise: Promise<any> | null = null;

async function getBrowser(): Promise<any> {
    if (!browserPromise) {
        browserPromise = puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        }).catch((error: unknown) => {
            browserPromise = null;
            throw error;
        });
    }
    return browserPromise;
}

/**
 * Fetch source HTML with a real Chromium session so JavaScript-based
 * browser challenges can run and issue their clearance cookies.
 */
export async function getSourcePage(url: string): Promise<AxiosResponse> {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.setUserAgent(USER_AGENT);
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Upgrade-Insecure-Requests': '1',
        });
        await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });

        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 45000,
        });

        // Cloudflare's "Just a moment..." page must be allowed to execute.
        const started = Date.now();
        while (Date.now() - started < 25000) {
            const state = await page.evaluate(() => ({
                title: document.title,
                text: (document.body?.innerText || '').slice(0, 1200),
                challenge: Boolean(
                    document.querySelector(
                        '#challenge-running, #challenge-stage, .cf-browser-verification'
                    )
                ),
            }));

            const stillChallenged =
                state.title.toLowerCase().includes('just a moment') ||
                state.challenge ||
                /enable javascript and cookies|checking your browser/i.test(state.text);

            if (!stillChallenged) break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        const html = await page.content();
        const title = await page.title();
        const bodyText = await page.evaluate(
            () => (document.body?.innerText || '').slice(0, 1200)
        );

        if (
            title.toLowerCase().includes('just a moment') ||
            /enable javascript and cookies|checking your browser/i.test(bodyText)
        ) {
            const error = new Error(
                'Upstream Cloudflare challenge did not clear in the Vercel browser session.'
            ) as Error & { response?: { status: number; data: string } };
            error.response = {
                status: response?.status() || 403,
                data: html.slice(0, 1200),
            };
            throw error;
        }

        const status = response?.status() || 200;
        if (status >= 400) {
            const error = new Error(`Upstream returned HTTP ${status}`) as Error & {
                response?: { status: number; data: string };
            };
            error.response = { status, data: html.slice(0, 1200) };
            throw error;
        }

        return {
            data: html,
            status,
            statusText: response?.statusText() || 'OK',
            headers: response?.headers() || {},
            config: {} as AxiosResponse['config'],
            request: response,
        } as AxiosResponse;
    } finally {
        await page.close().catch(() => undefined);
    }
}

export function respondSourceError(
    res: Response,
    error: unknown,
    source: string
): void {
    const axiosError = error as AxiosError;
    const status = (error as any)?.response?.status;
    const rawBody = (error as any)?.response?.data;
    const body =
        typeof rawBody === 'string'
            ? rawBody.replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 500)
            : undefined;

    console.error('[source-request]', {
        source,
        status: status ?? null,
        code: axiosError.code ?? null,
        message: error instanceof Error ? error.message : String(error),
        body,
    });

    res.status(502).json({
        error: 'UPSTREAM_SOURCE_ERROR',
        message:
            status === 403
                ? 'Cloudflare/sumber masih menolak sesi browser Vercel (HTTP 403).'
                : status
                  ? `Sumber gagal merespons (HTTP ${status}).`
                  : 'Browser serverless gagal membuka sumber data.',
        source,
        upstreamStatus: status ?? null,
        details: body || (error instanceof Error ? error.message : undefined),
    });
}
