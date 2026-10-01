import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright-core';
import type { CheckDef } from './doctor.ts';

/**
 * Headless Chromium for turning HTML into PDF and PNG (deck, doc and visual renderers).
 * Uses Playwright's Chromium if installed (`npx playwright install chromium`), else the
 * system Google Chrome.
 */
async function launch(): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  try {
    return await chromium.launch();
  } catch (first: any) {
    try {
      return await chromium.launch({ channel: 'chrome' });
    } catch {
      throw new Error(`no headless browser available: ${String(first?.message ?? first).split('\n')[0]}. Fix: run \`npx playwright install chromium\` or install Google Chrome.`);
    }
  }
}

export async function withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  const browser = await launch();
  try { return await fn(browser); } finally { await browser.close(); }
}

export interface CaptureOptions {
  /** Viewport in CSS px. */
  width?: number;
  height?: number;
  /** PNG: capture the full scrollable page. */
  fullPage?: boolean;
  /** Device scale factor for PNG (2 = retina). */
  scale?: number;
  /** PDF: page format or size; defaults to Letter, CSS @page wins when set. */
  format?: string;
}

/** Local HTML file -> PDF. Network requests are blocked so output never depends on the internet. */
export async function htmlToPdf(htmlFile: string, pdfFile: string, opts: CaptureOptions = {}): Promise<void> {
  await withBrowser(async (b) => {
    const page = await b.newPage({ viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 } });
    await page.route(/^https?:/, (r) => r.abort());
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: pdfFile, format: opts.format ?? 'Letter', printBackground: true, preferCSSPageSize: true });
  });
}

/** Local HTML file -> PNG. */
export async function htmlToPng(htmlFile: string, pngFile: string, opts: CaptureOptions = {}): Promise<void> {
  await withBrowser(async (b) => {
    const page = await b.newPage({ viewport: { width: opts.width ?? 1600, height: opts.height ?? 900 }, deviceScaleFactor: opts.scale ?? 1 });
    await page.route(/^https?:/, (r) => r.abort());
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await page.screenshot({ path: pngFile, fullPage: opts.fullPage ?? true });
  });
}

/** Doctor check for renderers that need it. */
export const BROWSER_CHECK: CheckDef = {
  id: 'headless-browser',
  label: 'Headless browser (HTML to PDF/PNG)',
  async run() {
    try {
      const version = await withBrowser(async (b) => b.version());
      return { ok: true, detail: `Chromium ${version}` };
    } catch (err: any) {
      return { ok: false, detail: 'not available', fix: 'run `npx playwright install chromium`, or install Google Chrome' };
    }
  },
};
