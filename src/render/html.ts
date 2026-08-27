/**
 * HTML/CSS -> PNG rendering.
 *
 * The last mile of the workflow the brief describes: generate a photograph,
 * drop it into a marketing template, render the composed result at exact social
 * dimensions. Playwright is an optional dependency — the photography pipeline
 * must not require a browser to exist, so it is imported lazily and the error
 * message tells you how to get it.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir } from "../core/paths.js";

export interface RenderHtmlOptions {
  /** Local file path or an http(s) URL. */
  input: string;
  output: string;
  width?: number;
  height?: number;
  /** Render only this element instead of the viewport. */
  selector?: string;
  fullPage?: boolean;
  deviceScaleFactor?: number;
  /** Extra settle time for webfonts and images, in ms. */
  waitMs?: number;
}

const INSTALL_HINT = `Playwright is not installed.

  cd <repo> && npm install --no-save playwright@1.62.1 && npx playwright install chromium

It is intentionally optional: photo generation never needs a browser.`;

/** Minimal structural type: Playwright is optional, so we never import its types. */
interface PlaywrightLike {
  chromium: {
    launch(options?: unknown): Promise<BrowserLike>;
  };
}
interface BrowserLike {
  newContext(options?: unknown): Promise<ContextLike>;
  close(): Promise<void>;
}
interface ContextLike {
  newPage(): Promise<PageLike>;
}
interface PageLike {
  goto(url: string, options?: unknown): Promise<unknown>;
  evaluate(fn: () => unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  $(selector: string): Promise<{ screenshot(options: { path: string }): Promise<unknown> } | null>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
}

async function loadPlaywright(): Promise<PlaywrightLike> {
  try {
    return (await import("playwright" as string)) as unknown as PlaywrightLike;
  } catch {
    throw new Error(INSTALL_HINT);
  }
}

export async function renderHtml(options: RenderHtmlOptions): Promise<string> {
  const width = options.width ?? 1080;
  const height = options.height ?? 1350;
  const output = isAbsolute(options.output) ? options.output : resolve(process.cwd(), options.output);
  ensureDir(dirname(output));

  const isUrl = /^https?:\/\//i.test(options.input);
  const target = isUrl
    ? options.input
    : (() => {
        const path = isAbsolute(options.input) ? options.input : resolve(process.cwd(), options.input);
        if (!existsSync(path)) throw new Error(`No such file: ${path}`);
        return pathToFileURL(path).href;
      })();

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: options.deviceScaleFactor ?? 2,
    });
    const page = await context.newPage();
    await page.goto(target, { waitUntil: "networkidle" });
    // Webfonts settle after networkidle often enough to matter.
    await page.evaluate(
      () => (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document.fonts.ready,
    );
    if (options.waitMs) await page.waitForTimeout(options.waitMs);

    if (options.selector) {
      const element = await page.$(options.selector);
      if (!element) throw new Error(`Selector not found on the page: ${options.selector}`);
      await element.screenshot({ path: output });
    } else {
      await page.screenshot({ path: output, fullPage: Boolean(options.fullPage) });
    }
    return output;
  } finally {
    await browser.close();
  }
}
