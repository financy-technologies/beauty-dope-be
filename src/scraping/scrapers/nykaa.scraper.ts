import { Injectable } from '@nestjs/common';
import { BaseScraper } from './base.scraper';
import { ScrapedProduct } from './types';

/**
 * Nykaa scraper — uses Nykaa's internal JSON API (same endpoints the website
 * calls via XHR). No browser needed.
 *
 * Category ID map was derived from Nykaa's navigation tree via DevTools.
 * Re-verify these IDs if the scraper starts returning empty results.
 */
const NYKAA_CATEGORY_IDS: Record<string, Record<string, number>> = {
  skin: {
    moisturiser: 3021,
    serum: 3022,
    cleanser: 3024,
    toner: 3025,
    'eye-cream': 3026,
    sunscreen: 3034,
    mask: 3029,
    exfoliator: 3032,
  },
  makeup: {
    foundation: 2048,
    concealer: 2049,
    blush: 2051,
    highlighter: 2058,
    eyeshadow: 2065,
    mascara: 2067,
    eyeliner: 2068,
    lipstick: 2053,
    'lip-gloss': 2055,
    bronzer: 2059,
  },
  hair: {
    shampoo: 2388,
    conditioner: 2389,
    'hair-mask': 2394,
    'hair-oil': 2393,
    'hair-serum': 2395,
    'dry-shampoo': 2396,
    styling: 2397,
  },
  'bath-and-body': {
    'body-lotion': 2420,
    'body-wash': 2418,
    scrub: 2422,
    deodorant: 2419,
    'hand-cream': 2424,
    'body-oil': 2423,
  },
};

const PRODUCTS_PER_PAGE = 50;
const MAX_PAGES = 3; // scrape up to 150 products per subcategory

@Injectable()
export class NykaaScraper extends BaseScraper {
  readonly platform = 'nykaa';
  readonly store = 'nykaa';
  readonly currency = 'INR';
  protected inrRate = 1;

  protected async scrapeSubcategory(
    category: string,
    subcategory: string,
  ): Promise<ScrapedProduct[]> {
    const categoryId = NYKAA_CATEGORY_IDS[category]?.[subcategory];
    if (!categoryId) {
      this.logger.debug(`No Nykaa category ID for ${category}/${subcategory} — skipping`);
      return [];
    }

    const products: ScrapedProduct[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const offset = (page - 1) * PRODUCTS_PER_PAGE;
      const url = `https://www.nykaa.com/api/product/search/v2/landing-page`;
      const params = {
        filters: `category_id:${categoryId}`,
        sort: 'popularity_desc',
        ptype: 'category',
        id: categoryId,
        offset,
        limit: PRODUCTS_PER_PAGE,
      };

      let data: any;
      try {
        data = await this.fetch(url, { params, headers: { Referer: 'https://www.nykaa.com/' } });
      } catch {
        break; // stop paging on error
      }

      const items: any[] = data?.response?.products ?? [];
      if (!items.length) break;

      for (const item of items) {
        const detail = await this.fetchProductDetail(item.id ?? item.productId);
        if (!detail) continue;

        products.push({
          name: item.name ?? item.productName ?? '',
          brand: item.brand ?? item.brandName ?? '',
          price: parseFloat(item.price ?? item.offerPrice ?? '0'),
          currency: 'INR',
          imageUrl: item.imageUrl ?? item.images?.[0]?.url ?? '',
          platform: this.platform,
          store: this.store,
          category,
          subcategory,
          size: item.packSize ?? item.size ?? '',
          ingredients: detail.ingredients,
          description: detail.description,
          sourceUrl: `https://www.nykaa.com/p/${item.slug ?? item.id}`,
          externalId: this.buildExternalId(item.id ?? item.productId),
          scrapedAt: new Date(),
        });

        await this.delay(500); // extra politeness for detail calls
      }

      if (items.length < PRODUCTS_PER_PAGE) break; // last page
    }

    return products;
  }

  /**
   * Fetch the product detail page to extract ingredients and description.
   * Nykaa renders details server-side in a JSON blob embedded in the HTML.
   */
  private async fetchProductDetail(
    productId: string | number,
  ): Promise<{ ingredients: string; description: string } | null> {
    try {
      const url = `https://www.nykaa.com/api/product/detail/${productId}`;
      const data: any = await this.fetch(url);
      const product = data?.response?.product ?? {};

      const ingredients: string =
        product.ingredients ??
        product.keyIngredients ??
        this.extractIngredientsSectionFromHtml(product.description ?? '');

      const description: string =
        (product.shortDescription ?? product.description ?? '').replace(/<[^>]+>/g, '').trim();

      return { ingredients, description };
    } catch {
      return null;
    }
  }

  /**
   * Some products embed "Ingredients:" inside the HTML description block.
   * Extract the raw text after that label.
   */
  private extractIngredientsSectionFromHtml(html: string): string {
    const $ = this.load(html);
    const text = $.root().text();
    const match = text.match(/ingredients[:\s]+(.+?)(?:\n\n|$)/is);
    return match?.[1]?.trim() ?? '';
  }
}
