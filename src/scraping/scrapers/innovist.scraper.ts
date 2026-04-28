import { Injectable } from '@nestjs/common';
import { BaseScraper } from './base.scraper';
import { ScrapedProduct } from './types';

/**
 * Innovist scraper — innovist.com (Shopify store)
 *
 * Innovist is a multi-brand Indian skincare marketplace carrying Chemist at
 * Play, Bare Anatomy, SunScoop, and VINCI Botanicals.
 *
 * ── Data source ────────────────────────────────────────────────────────────
 * Shopify's public collection products JSON endpoint (no auth required):
 *   https://innovist.com/collections/{slug}/products.json?limit=250&page=N
 *
 * Returns full product objects including: id, title, handle, vendor,
 * product_type, variants (price, compare_at_price, sku), images.
 *
 * ── Ingredient extraction ──────────────────────────────────────────────────
 * Ingredients are NOT in the product JSON — they live inside an "All
 * ingredients" accordion section on each product's HTML page.
 * The scraper fetches the HTML page per product and extracts the INCI list
 * using a targeted regex pattern matched against the accordion content.
 *
 * ── Collections scraped ────────────────────────────────────────────────────
 *   cleanser    → /collections/face-washes
 *   moisturiser → /collections/moisturizers  (+ceramide-based-moisturizers)
 *   sunscreen   → /collections/sunscoop
 *   serum       → /collections/face-serum
 *
 * Multiple collection slugs per subcategory are supported — products are
 * deduped by externalId before returning so overlap doesn't create duplicates.
 *
 * ── No cookie required ────────────────────────────────────────────────────
 * The Shopify JSON API and Innovist product pages are publicly accessible.
 */

const SHOPIFY_LIST_URL = (slug: string, page: number) =>
  `https://innovist.com/collections/${slug}/products.json?limit=250&page=${page}`;

const PRODUCT_HTML_URL = (handle: string) =>
  `https://innovist.com/products/${handle}`;

// Collection slugs per subcategory. When multiple slugs are listed, all are
// fetched and the combined results are deduped by externalId.
const INNOVIST_COLLECTIONS: Partial<Record<string, Record<string, string[]>>> = {
  skin: {
    cleanser:    ['face-washes'],
    moisturiser: ['moisturizers', 'ceramide-based-moisturizers'],
    sunscreen:   ['sunscoop'],
    serum:       ['face-serum'],
  },
};

// Max Shopify pages to fetch per collection slug (250 products per page).
// Innovist has a relatively small catalogue so 5 pages (1,250 cap) is plenty.
const MAX_PAGES = 5;

@Injectable()
export class InnovistScraper extends BaseScraper {
  readonly platform = 'innovist';
  readonly store    = 'innovist';
  readonly currency = 'INR';
  protected inrRate = 1;

  // ─── Template method ───────────────────────────────────────────────────────

  protected async scrapeSubcategory(
    category: string,
    subcategory: string,
  ): Promise<ScrapedProduct[]> {
    const slugs = INNOVIST_COLLECTIONS[category]?.[subcategory];
    if (!slugs?.length) {
      this.logger.debug(`No Innovist collection for "${category}/${subcategory}" — skipping`);
      return [];
    }

    // Fetch all slugs and merge, deduping by externalId
    const seen     = new Set<string>();
    const products: ScrapedProduct[] = [];

    for (const slug of slugs) {
      const batch = await this.fetchCollection(slug, category, subcategory);
      for (const p of batch) {
        if (!seen.has(p.externalId)) {
          seen.add(p.externalId);
          products.push(p);
        }
      }
    }

    return products;
  }

  /**
   * Remove size-variant duplicates.
   *
   * Innovist lists the same formula in multiple sizes as separate Shopify
   * products. After `cleanTitle` strips the size suffix from the title,
   * identical-name products from the same brand are the same formula.
   *
   * Key = `${brand}::${cleanedName}` (both already set on the product object).
   * Winner = highest price (= standard/full size; trial minis are cheapest).
   */
  private deduplicateSizeVariants(products: ScrapedProduct[]): ScrapedProduct[] {
    const groups = new Map<string, ScrapedProduct>();

    for (const p of products) {
      const key = `${p.brand.toLowerCase()}::${p.name.toLowerCase()}`;
      const existing = groups.get(key);
      if (!existing || p.price > existing.price) {
        groups.set(key, p);
      }
    }

    return [...groups.values()];
  }

  // ─── Collection fetcher ────────────────────────────────────────────────────

  private async fetchCollection(
    slug: string,
    category: string,
    subcategory: string,
  ): Promise<ScrapedProduct[]> {
    const products: ScrapedProduct[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      let data: any;
      try {
        data = await this.fetch(SHOPIFY_LIST_URL(slug, page), {
          headers: {
            Accept: 'application/json',
            Referer: `https://innovist.com/collections/${slug}`,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Innovist collection "${slug}" page ${page} failed: ${(err as Error).message}`,
        );
        break;
      }

      const items: any[] = data?.products ?? [];
      if (!items.length) break;

      for (const item of items) {
        // Shopify returns pack variants as separate products. Skip bundles/packs
        // by filtering titles that mention "Pack of" to avoid duplicate actives.
        if (/pack\s+of\s+\d/i.test(item.title)) continue;

        const handle     = item.handle as string;
        const productId  = item.id as number;
        const sourceUrl  = `https://innovist.com/products/${handle}`;
        const externalId = this.buildExternalId(productId);

        // Primary variant
        const variant = item.variants?.[0] ?? {};
        const price   = parseFloat(variant.price ?? '0') || 0;

        // Image
        const imageUrl: string = item.images?.[0]?.src ?? '';

        // Size — extract from title (e.g. "Serum - 30 ml" or "Wash | 100ml")
        const size = this.extractSize(item.title ?? '');

        // Description — strip HTML from body_html
        const description = this.stripHtml(item.body_html ?? '').slice(0, 500);

        // Ingredients — must fetch the HTML product page
        const ingredients = await this.fetchIngredients(handle);

        products.push({
          name:        this.cleanTitle(item.title ?? ''),
          brand:       (item.vendor as string) ?? '',
          price,
          currency:    'INR',
          imageUrl,
          platform:    this.platform,
          store:       this.store,
          category,
          subcategory,
          size,
          ingredients,
          description,
          sourceUrl,
          externalId,
          scrapedAt:   new Date(),
        });

        await this.delay(800); // polite gap between product page fetches
      }

      this.logger.debug(
        `Innovist "${slug}" page ${page}: ${items.length} items, ` +
        `${products.length} collected so far`,
      );

      // Shopify returns fewer items than the limit on the last page
      if (items.length < 250) break;
    }

    return products;
  }

  // ─── Ingredient extraction from product HTML ───────────────────────────────

  /**
   * Fetches the product HTML page and extracts the full INCI ingredient list
   * from the "All ingredients" accordion/tab section.
   *
   * Shopify stores render accordion content in the initial HTML (not via XHR),
   * so the ingredient list is present in the raw page source.
   *
   * Tries three progressively looser patterns in order:
   *   1. Look for content immediately after "All ingredients" heading in HTML
   *   2. Look for a long comma-separated INCI-style list near any "ingredients" text
   *   3. Extract key actives from body_html as a last resort
   */
  private async fetchIngredients(handle: string): Promise<string> {
    let html: string;
    try {
      html = await this.fetch<string>(
        PRODUCT_HTML_URL(handle),
        { responseType: 'text' },
        3,
      );
    } catch {
      return '';
    }

    // ── Pattern 1: Standard Shopify accordion — "All ingredients" heading ───
    // Matches content in the panel following the "All ingredients" summary/heading.
    // The [\s\S]{0,800} allows for surrounding HTML tags before the text node.
    const p1 = html.match(
      /[Aa]ll\s+[Ii]ngredients?[^<]{0,20}<\/[^>]+>[\s\S]{0,800}?>([\w][\w\s\-(),'.%+\/]{20,}(?:,\s*[\w][\w\s\-(),'.%+\/]{2,}){5,})</,
    );
    if (p1?.[1]) return this.normalizeIngredientString(p1[1]);

    // ── Pattern 2: "All ingredients" text followed by INCI list anywhere ───
    // More permissive — matches the list text that follows the heading,
    // regardless of intervening HTML structure.
    const p2 = html.match(
      /[Aa]ll\s+[Ii]ngredients?[\s\S]{0,1200}?((?:Purified Water|Aqua|Water|Butylene Glycol|Propanediol|Cyclopentasiloxane|Dimethicone)[^<]{30,}(?:,\s*[\w\d][^,<]{2,60}){4,})/,
    );
    if (p2?.[1]) return this.normalizeIngredientString(p2[1]);

    // ── Pattern 3: Any "ingredients" label + long comma-separated text ────
    const p3 = html.match(
      /[Ii]ngredients?[\s\S]{0,600}?((?:[A-Z][a-z][\w\s\-(),'.%+\/]{1,50},\s*){5,}[A-Z][a-z][\w\s\-(),'.%+\/]{1,50})/,
    );
    if (p3?.[1]) return this.normalizeIngredientString(p3[1]);

    return '';
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Remove size suffix from product title for a clean display name.
   * "2% Salicylic Acid Face Wash - 100 ml" → "2% Salicylic Acid Face Wash"
   */
  private cleanTitle(title: string): string {
    return title
      .replace(/\s*[-|]\s*\d+\s*(?:ml|g|gm|oz|L|kg)\b.*/i, '')
      .replace(/\s*\|\s*(?:SPF|PA)\b.*/i, '')  // keep SPF info for sunscreens
      .trim();
  }

  /**
   * Extract size string from product title.
   * Looks for patterns like "- 30 ml", "| 100gm", "100ml" at end of title.
   */
  private extractSize(title: string): string {
    const match = title.match(/[\-|]\s*(\d+\s*(?:ml|g|gm|oz|L|kg))\b/i);
    return match?.[1]?.trim() ?? '';
  }

  /** Strip HTML tags and collapse whitespace. */
  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Normalize a raw ingredient string — collapse whitespace, trim. */
  private normalizeIngredientString(raw: string): string {
    return raw
      .replace(/\\n|\\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
