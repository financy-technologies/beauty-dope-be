import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cheerio = require('cheerio') as { load: (html: string) => any };
import { CATEGORY_MAP, ScrapedProduct, ScrapeResult } from './types';

const DEFAULT_DELAY_MS = 1500;   // polite delay between requests
const MAX_RETRIES = 3;

/**
 * Abstract base class for all platform scrapers.
 *
 * Provides:
 *  - An axios instance configured with realistic browser headers
 *  - Retry logic with exponential back-off
 *  - Cheerio convenience wrapper
 *  - Rate-limit delay between requests
 *  - A template-method interface: subclasses implement scrapeSubcategory()
 */
export abstract class BaseScraper {
  protected readonly logger: Logger;
  protected readonly http: AxiosInstance;
  abstract readonly platform: string;
  abstract readonly store: string;
  abstract readonly currency: string;
  /** Optional INR conversion rate (set to 1 for INR-native platforms). */
  protected inrRate = 1;

  constructor() {
    this.logger = new Logger(this.constructor.name);
    this.http = axios.create({
      timeout: 30_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
      },
    });
  }

  // ─── Template Method ──────────────────────────────────────────────────────

  /**
   * Entry point called by ScrapingService.
   * Iterates over all known categories/subcategories and aggregates results.
   */
  async scrape(categoryFilter?: string[]): Promise<ScrapeResult> {
    const products: ScrapedProduct[] = [];
    const errors: string[] = [];

    const categories = categoryFilter?.length
      ? Object.entries(CATEGORY_MAP).filter(([cat]) => categoryFilter.includes(cat))
      : Object.entries(CATEGORY_MAP);

    for (const [category, subcategories] of categories) {
      for (const subcategory of subcategories) {
        try {
          this.logger.debug(`Scraping ${this.platform} › ${category} › ${subcategory}`);
          const batch = await this.scrapeSubcategory(category, subcategory);
          products.push(...batch);
          await this.delay();
        } catch (err) {
          const msg = `${this.platform}/${category}/${subcategory}: ${(err as Error).message}`;
          this.logger.warn(msg);
          errors.push(msg);
        }
      }
    }

    this.logger.log(`${this.platform}: ${products.length} products scraped, ${errors.length} errors`);
    return { platform: this.platform, products, errors };
  }

  /**
   * Scrape a single category → subcategory page / API endpoint.
   * Subclasses MUST implement this.
   */
  protected abstract scrapeSubcategory(
    category: string,
    subcategory: string,
  ): Promise<ScrapedProduct[]>;

  // ─── Utilities ────────────────────────────────────────────────────────────

  /** Fetch with automatic retry and exponential back-off. */
  protected async fetch<T = any>(
    url: string,
    options?: Parameters<AxiosInstance['get']>[1],
    retries = MAX_RETRIES,
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await this.http.get<T>(url, options);
        return res.data;
      } catch (err: any) {
        if (attempt === retries) throw err;
        const wait = 2 ** attempt * 1000;
        this.logger.warn(`Retry ${attempt}/${retries} for ${url} — waiting ${wait}ms`);
        await this.delay(wait);
      }
    }
    throw new Error(`Failed after ${retries} attempts: ${url}`);
  }

  /** Load HTML into a cheerio instance. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected load(html: string): any {
    return cheerio.load(html);
  }

  /** Polite delay (default or specified ms). */
  protected delay(ms = DEFAULT_DELAY_MS): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Convert a price to INR using the stored rate. */
  protected toInr(price: number): number {
    return parseFloat((price * this.inrRate).toFixed(2));
  }

  /** Build a unique external ID for a product on this platform. */
  protected buildExternalId(platformProductId: string | number): string {
    return `${this.platform}::${platformProductId}`;
  }

  /**
   * Diagnostic probe: hit a URL directly (no retry, no parsing) and return
   * the raw HTTP status, headers, and first 500 chars of the response body.
   * Used by the test script to show exactly why a scraper is failing.
   */
  async probe(url: string, params?: Record<string, any>): Promise<{
    status: number;
    contentType: string;
    bodyPreview: string;
    blocked: boolean;
    redirected: boolean;
    finalUrl?: string;
  }> {
    try {
      const res = await this.http.get(url, {
        params,
        maxRedirects: 5,
        validateStatus: () => true,  // don't throw on 4xx/5xx
        responseType: 'text',
        timeout: 15_000,
      });

      const body: string = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      const contentType: string = res.headers['content-type'] ?? '';
      const blocked =
        res.status === 403 ||
        res.status === 429 ||
        res.status === 503 ||
        body.toLowerCase().includes('cloudflare') ||
        body.toLowerCase().includes('captcha') ||
        body.toLowerCase().includes('access denied');

      return {
        status: res.status,
        contentType,
        bodyPreview: body.slice(0, 500),
        blocked,
        redirected: res.request?.res?.responseUrl !== url,
        finalUrl: res.request?.res?.responseUrl,
      };
    } catch (err: any) {
      return {
        status: 0,
        contentType: '',
        bodyPreview: err?.message ?? String(err),
        blocked: false,
        redirected: false,
      };
    }
  }
}
