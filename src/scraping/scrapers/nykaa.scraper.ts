import { Injectable } from '@nestjs/common';
import { BaseScraper } from './base.scraper';
import { ScrapedProduct } from './types';

/**
 * Nykaa scraper — uses the app-api XHR listing endpoint + HTML product page
 * for ingredients.
 *
 * ── Cookie requirement ────────────────────────────────────────────────────
 * Nykaa uses Akamai Bot Manager which injects a `bm_sz` session cookie via
 * JavaScript. Without it the server returns 403/Access Denied.
 *
 * How to get a fresh cookie (valid for ~2 hours):
 *   1. Open https://www.nykaa.com in Chrome
 *   2. DevTools → Application → Cookies → www.nykaa.com
 *   3. Copy the bm_sz (and optionally ak_bmsc) cookie value
 *   4. Set the env var before running:
 *        export NYKAA_COOKIE="bm_sz=<value>"
 *        npm run test:scrapers
 *
 * ── Category IDs (from DevTools) ─────────────────────────────────────────
 *   API uses L1 IDs for the category_id param:
 *     skin=3, makeup=12, hair=24, bath-and-body=273
 *   Each product response has primary_categories.l2/l3 with names that we
 *   map to our internal subcategory taxonomy.
 */

const LIST_URL = 'https://www.nykaa.com/app-api/index.php/products/list';

// L1 category IDs for broad categories (confirmed via DevTools).
// skin L1 (id=3) returns empty — skin uses direct subcategory IDs instead.
const NYKAA_L1_IDS: Record<string, number> = {
  makeup:         12,
  hair:           24,
  'bath-and-body':273,
};

// Direct subcategory IDs verified via DevTools → Network → products/list call.
// When a direct ID exists, the entire page is already filtered — no l3 matching needed.
// Key format: "category/subcategory"
const NYKAA_DIRECT_IDS: Record<string, { id: number; referer: string }> = {
  'skin/anti-aging': {
    id:      25763,
    referer: 'https://www.nykaa.com/skin/shop-by-concern/wrinkles-fine-lines/c/25763',
  },
  'skin/moisturiser': {
    id:      8394,
    referer: 'https://www.nykaa.com/skin/moisturizers/face-moisturizer-day-cream/c/8394',
  },
  'skin/cleanser': {
    id:      8380,
    referer: 'https://www.nykaa.com/skin/cleansers/cleanser/c/8380',
  },
  'skin/sunscreen': {
    id:      8429,
    referer: 'https://www.nykaa.com/skin/sun-care/face-sunscreen/c/8429',
  },
  'skin/serum': {
    id:      8397,
    referer: 'https://www.nykaa.com/skin/serums/serums-essence/c/8397',
  },
};

// Map Nykaa l3 / l2 category names → our subcategory keys.
// Keys are lowercase Nykaa names, values are our canonical subcategory names.
const NYKAA_CAT_NAME_MAP: Record<string, string> = {
  // skin
  'anti aging':             'anti-aging',
  'anti ageing':            'anti-aging',
  'anti-aging':             'anti-aging',
  'anti-ageing':            'anti-aging',
  'anti aging creams':      'anti-aging',
  'anti ageing creams':     'anti-aging',
  'anti aging treatments':  'anti-aging',
  'anti ageing treatments': 'anti-aging',
  'moisturizers':           'moisturiser',
  'moisturizer':            'moisturiser',
  'moisturisers':           'moisturiser',
  'face moisturizers':      'moisturiser',
  'serums':                 'serum',
  'face serums':            'serum',
  'face wash':              'cleanser',
  'cleansers':              'cleanser',
  'face cleansers':         'cleanser',
  'toners':                 'toner',
  'face toners':            'toner',
  'eye creams':             'eye-cream',
  'eye cream':              'eye-cream',
  'eye care':               'eye-cream',
  'sunscreen':              'sunscreen',
  'sunscreens':             'sunscreen',
  'face sunscreen':         'sunscreen',
  'face sunscreens':        'sunscreen',
  'spf':                    'sunscreen',
  'face masks':             'mask',
  'sheet masks':            'mask',
  'face scrubs':            'exfoliator',
  'exfoliators':            'exfoliator',
  // makeup
  'foundation':             'foundation',
  'foundations':            'foundation',
  'concealer':              'concealer',
  'concealers':             'concealer',
  'blush':                  'blush',
  'highlighter':            'highlighter',
  'highlighters':           'highlighter',
  'eyeshadow':              'eyeshadow',
  'eye shadow':             'eyeshadow',
  'mascara':                'mascara',
  'eyeliner':               'eyeliner',
  'eye liner':              'eyeliner',
  'lipstick':               'lipstick',
  'lipsticks':              'lipstick',
  'lip gloss':              'lip-gloss',
  'bronzer':                'bronzer',
  'bronzers':               'bronzer',
  // hair
  'shampoo':                'shampoo',
  'conditioner':            'conditioner',
  'conditioners':           'conditioner',
  'hair masks':             'hair-mask',
  'hair mask':              'hair-mask',
  'hair oils':              'hair-oil',
  'hair oil':               'hair-oil',
  'hair serums':            'hair-serum',
  'hair serum':             'hair-serum',
  'dry shampoo':            'dry-shampoo',
  'hair styling':           'styling',
  // bath-and-body
  'body lotion':            'body-lotion',
  'body lotions':           'body-lotion',
  'body wash':              'body-wash',
  'body scrubs':            'scrub',
  'body scrub':             'scrub',
  'deodorant':              'deodorant',
  'deodorants':             'deodorant',
  'hand cream':             'hand-cream',
  'hand creams':            'hand-cream',
  'body oil':               'body-oil',
  'body oils':              'body-oil',
};

// Referer per L1 — Nykaa's WAF checks this
const CATEGORY_REFERERS: Record<string, string> = {
  skin:           'https://www.nykaa.com/skincare/c/3',
  makeup:         'https://www.nykaa.com/sp/makeup-clp-desktop/makeup',
  hair:           'https://www.nykaa.com/haircare/c/24',
  'bath-and-body':'https://www.nykaa.com/bath-body/c/273',
};

// Headers copied from a real Chrome DevTools XHR capture for www.nykaa.com
const XHR_HEADERS: Record<string, string> = {
  'Accept':           'application/json, text/plain, */*',
  'Accept-Encoding':  'gzip, deflate, br',
  'Accept-Language':  'en-US,en;q=0.9',
  'Cache-Control':    'no-cache',
  'Connection':       'keep-alive',
  'Host':             'www.nykaa.com',
  'Pragma':           'no-cache',
  'Sec-Fetch-Dest':   'xhr',
  'Sec-Fetch-Mode':   'cors',
  'Sec-Fetch-Site':   'same-origin',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const HTML_HEADERS: Record<string, string> = {
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control':   'no-cache',
  'Connection':      'keep-alive',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const PRODUCTS_PER_PAGE = 20; // API returns 20 per page for L1 categories
const MAX_PAGES = 5;          // up to 100 products per L1 category per run

@Injectable()
export class NykaaScraper extends BaseScraper {
  readonly platform = 'nykaa';
  readonly store    = 'nykaa';
  readonly currency = 'INR';
  protected inrRate = 1;

  private get cookie(): string {
    return process.env.NYKAA_COOKIE ?? '';
  }

  private buildXhrHeaders(referer: string): Record<string, string> {
    return {
      ...XHR_HEADERS,
      Referer: referer,
      ...(this.cookie ? { Cookie: this.cookie } : {}),
    };
  }

  private buildHtmlHeaders(referer: string): Record<string, string> {
    return {
      ...HTML_HEADERS,
      Referer: referer,
      ...(this.cookie ? { Cookie: this.cookie } : {}),
    };
  }

  /** Map Nykaa's l3 or l2 category name to our subcategory key. */
  private mapSubcategory(l3Name?: string, l2Name?: string): string {
    const names = [l3Name, l2Name].filter(Boolean) as string[];
    for (const name of names) {
      const key = name.toLowerCase();
      if (NYKAA_CAT_NAME_MAP[key]) return NYKAA_CAT_NAME_MAP[key];
    }
    // Partial match fallback
    for (const name of names) {
      const lower = name.toLowerCase();
      for (const [nykaaName, ourKey] of Object.entries(NYKAA_CAT_NAME_MAP)) {
        if (lower.includes(nykaaName) || nykaaName.includes(lower)) return ourKey;
      }
    }
    return l3Name?.toLowerCase().replace(/\s+/g, '-') ?? 'other';
  }

  protected async scrapeSubcategory(
    category: string,
    subcategory: string,
  ): Promise<ScrapedProduct[]> {
    if (!this.cookie) {
      this.logger.warn(
        'NYKAA_COOKIE is not set — Akamai will block requests. ' +
        'See the comment at the top of nykaa.scraper.ts for setup instructions.',
      );
    }

    // Direct subcategory ID takes priority — no l3 filtering needed
    const direct = NYKAA_DIRECT_IDS[`${category}/${subcategory}`];
    if (direct) {
      return this.fetchPages(direct.id, category, subcategory, direct.referer, true);
    }

    // L1-level ID + l3 name filtering for makeup / hair / bath-and-body
    const l1Id = NYKAA_L1_IDS[category];
    if (!l1Id) {
      this.logger.debug(`No Nykaa ID for "${category}/${subcategory}" — skipping`);
      return [];
    }

    const referer = CATEGORY_REFERERS[category] ?? 'https://www.nykaa.com/';
    return this.fetchPages(l1Id, category, subcategory, referer, false);
  }

  /**
   * Scrape a specific Nykaa category by its direct numeric ID, across all pages.
   *
   * Designed for standalone bulk-scrape scripts. Each page's products are
   * emitted to `onBatch` immediately after being fetched (before the next page
   * starts), so callers can persist to DB incrementally rather than waiting
   * for all pages to finish.
   *
   * @param categoryId  Nykaa numeric category ID (e.g. 8380 for cleanser)
   * @param category    Our canonical top-level category (e.g. 'skin')
   * @param subcategory Our canonical subcategory (e.g. 'cleanser')
   * @param referer     Category page URL used as the HTTP Referer header
   * @param maxPages    Maximum pages to fetch (set to the known total for the URL)
   * @param onBatch     Optional async callback invoked after each page completes
   */
  async scrapeDirectCategory(
    categoryId: number,
    category: string,
    subcategory: string,
    referer: string,
    maxPages: number,
    onBatch?: (batch: ScrapedProduct[]) => Promise<void>,
  ): Promise<ScrapedProduct[]> {
    if (!this.cookie) {
      this.logger.warn(
        'NYKAA_COOKIE is not set — Akamai will block requests. ' +
        'See the comment at the top of nykaa.scraper.ts for setup instructions.',
      );
    }
    return this.fetchPages(categoryId, category, subcategory, referer, true, maxPages, onBatch);
  }

  private async fetchPages(
    categoryId: number,
    category: string,
    subcategory: string,
    referer: string,
    isDirect: boolean,
    maxPages = MAX_PAGES,
    onBatch?: (batch: ScrapedProduct[]) => Promise<void>,
  ): Promise<ScrapedProduct[]> {
    const xhrHeaders  = this.buildXhrHeaders(referer);
    const htmlHeaders = this.buildHtmlHeaders(referer);
    const products: ScrapedProduct[] = [];

    for (let page = 1; page <= maxPages; page++) {
      let data: any;
      try {
        data = await this.fetch(LIST_URL, {
          params: {
            category_id: categoryId,
            page_no:     page,
            ptype:       'plp',
            sort:        'popularity',
            dir:         'desc',
          },
          headers: xhrHeaders,
        });
      } catch (err) {
        this.logger.warn(`Nykaa listing page ${page} failed: ${(err as Error).message}`);
        break;
      }

      if (data?.status !== 'success') {
        this.logger.warn(
          `Nykaa non-success on page ${page}: status="${data?.status}" msg="${data?.message ?? ''}"`,
        );
        break;
      }

      const items: any[] = data?.response?.products ?? [];
      if (!items.length) break;

      // Collect products for this page before flushing via onBatch
      const pageBatch: ScrapedProduct[] = [];

      for (const item of items) {
        const productId = item.id ?? item.productId;
        if (!productId) continue;

        // For L1-based fetches, filter by l3 name to isolate the subcategory.
        // For direct subcategory IDs, all items already belong to the subcategory.
        if (!isDirect) {
          const l3Name = item.primary_categories?.l3?.name;
          const l2Name = item.primary_categories?.l2?.name;
          const derivedSubcategory = this.mapSubcategory(l3Name, l2Name);
          if (derivedSubcategory !== subcategory) continue;
        }

        const slug = item.slug ?? `p/${productId}`;
        const sourceUrl = `https://www.nykaa.com/${slug}`;

        // Fetch ingredients from the product HTML page (__PRELOADED_STATE__)
        const ingredients = await this.fetchIngredientsFromPage(sourceUrl, htmlHeaders);

        pageBatch.push({
          name:        this.stripHtml(item.name ?? item.product_title ?? ''),
          brand:       this.stripHtml(item.brand_name ?? ''),
          price:       this.parsePrice(item.final_price ?? item.price),
          currency:    'INR',
          imageUrl:    item.new_image_url ?? item.image_url ?? '',
          platform:    this.platform,
          store:       this.store,
          category,
          subcategory,
          size:        item.pack_size ?? '',
          quantity:    this.parseQuantity(item.quantity ?? item.qty ?? item.stock_qty ?? item.stockQty),
          ingredients,
          description: '',
          sourceUrl,
          externalId:  this.buildExternalId(productId),
          scrapedAt:   new Date(),
        });

        await this.delay(800); // polite gap between product fetches
      }

      products.push(...pageBatch);

      // Flush this page to caller (e.g. for DB persistence) before fetching the next
      if (onBatch && pageBatch.length) {
        await onBatch(pageBatch);
      }

      this.logger.debug(
        `Nykaa ${category}/${subcategory} page ${page}: ` +
        `${items.length} items, ${products.length} matched so far`,
      );
      if (items.length < PRODUCTS_PER_PAGE) break;
    }

    return products;
  }

  // ─── Ingredient extraction from product HTML page ──────────────────────

  /**
   * Fetches the product HTML page and extracts the ingredients string from
   * `window.__PRELOADED_STATE__`. Falls back to a regex scan over raw HTML.
   */
  private async fetchIngredientsFromPage(
    productUrl: string,
    headers: Record<string, string>,
  ): Promise<string> {
    try {
      const html: string = await this.fetch(productUrl, { headers, responseType: 'text' }, 1);

      // Fast targeted regex — avoids parsing the enormous state JSON
      const match = html.match(/"ingredients"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (match?.[1]) {
        const raw = match[1]
          .replace(/\\"/g, '"')
          .replace(/\\n/g, ' ')
          .replace(/\\r/g, '');
        return this.stripHtml(raw).trim();
      }
    } catch {
      // Silently skip — ingredients are optional
    }
    return '';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private parsePrice(raw: any): number {
    if (!raw) return 0;
    return parseFloat(String(raw).replace(/[^0-9.]/g, '')) || 0;
  }

  private parseQuantity(raw: any): number | undefined {
    if (raw === null || raw === undefined) return undefined;
    const n = parseInt(String(raw), 10);
    return isNaN(n) ? undefined : n;
  }
}
