import { Injectable } from '@nestjs/common';
import { BaseScraper } from './base.scraper';
import { ScrapedProduct } from './types';

/**
 * Sephora (sephora.com) scraper — uses Sephora's internal catalog API.
 *
 * 1 USD ≈ 83 INR (set via inrRate; update periodically or plug in a live rate).
 *
 * Sephora's category IDs were extracted from the site's navigation JSON at
 * https://www.sephora.com/api/content-target/v2/page/nav-category.
 */
const SEPHORA_CATEGORY_IDS: Record<string, Record<string, string>> = {
  skin: {
    moisturiser: 'moisturizers-cream',
    serum: 'serums-vitamin-c',
    cleanser: 'facial-cleansers',
    toner: 'toners-astringents',
    'eye-cream': 'eye-creams-treatments',
    sunscreen: 'sunscreen-spf',
    mask: 'face-masks',
    exfoliator: 'facial-peels-exfoliants',
  },
  makeup: {
    foundation: 'foundation',
    concealer: 'concealer',
    blush: 'blush',
    highlighter: 'highlighter',
    eyeshadow: 'eyeshadow',
    mascara: 'mascara',
    eyeliner: 'eyeliner',
    lipstick: 'lipstick',
    'lip-gloss': 'lip-gloss',
    bronzer: 'bronzer',
  },
  hair: {
    shampoo: 'shampoo',
    conditioner: 'conditioner',
    'hair-mask': 'hair-mask-deep-conditioner',
    'hair-oil': 'hair-oil',
    'hair-serum': 'hair-serum',
    'dry-shampoo': 'dry-shampoo',
    styling: 'hair-styling',
  },
  'bath-and-body': {
    'body-lotion': 'body-lotion-body-oil',
    'body-wash': 'bath-shower-gel',
    scrub: 'body-scrub',
    deodorant: 'deodorant-antiperspirant',
    'hand-cream': 'hand-cream-sanitizer',
    'body-oil': 'body-oil',
  },
};

const PRODUCTS_PER_PAGE = 60;
const MAX_PAGES = 2;

@Injectable()
export class SephoraScraper extends BaseScraper {
  readonly platform = 'sephora';
  readonly store = 'sephora';
  readonly currency = 'USD';
  protected inrRate = 83;  // ~83 INR per USD — update as needed

  protected async scrapeSubcategory(
    category: string,
    subcategory: string,
  ): Promise<ScrapedProduct[]> {
    const categoryId = SEPHORA_CATEGORY_IDS[category]?.[subcategory];
    if (!categoryId) return [];

    const products: ScrapedProduct[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const currentPage = page;
      const url = 'https://www.sephora.com/api/catalog/search';
      const params = {
        currentPage,
        pageSize: PRODUCTS_PER_PAGE,
        content: true,
        categoryId,
        sortBy: 'TOP_SELLERS',
        col: 1,
      };

      let data: any;
      try {
        data = await this.fetch(url, {
          params,
          headers: {
            Referer: `https://www.sephora.com/shop/${categoryId}`,
            'x-requested-with': 'XMLHttpRequest',
          },
        });
      } catch {
        break;
      }

      const items: any[] = data?.products ?? [];
      if (!items.length) break;

      for (const item of items) {
        const priceUsd = this.extractPrice(item);
        const ingredients = await this.fetchIngredients(item.productId);

        products.push({
          name: item.displayName ?? '',
          brand: item.brandName ?? '',
          price: priceUsd,
          currency: 'USD',
          imageUrl: item.heroImage ?? item.imageAltText ?? '',
          platform: this.platform,
          store: this.store,
          category,
          subcategory,
          size: item.size ?? '',
          ingredients,
          description: item.longDescription ?? item.quickLookDescription ?? '',
          sourceUrl: `https://www.sephora.com/product/${item.productId}`,
          externalId: this.buildExternalId(item.productId),
          scrapedAt: new Date(),
        });

        await this.delay(400);
      }

      if (items.length < PRODUCTS_PER_PAGE) break;
    }

    return products;
  }

  private extractPrice(item: any): number {
    const raw =
      item.currentSku?.listPrice ??
      item.regularPrice ??
      item.currentSku?.salePrice ??
      '0';
    return parseFloat(String(raw).replace(/[^0-9.]/g, '')) || 0;
  }

  private async fetchIngredients(productId: string): Promise<string> {
    try {
      const url = `https://www.sephora.com/api/catalog/product/${productId}/ingredients`;
      const data: any = await this.fetch(url);
      return (data?.ingredients ?? '').replace(/<[^>]+>/g, '').trim();
    } catch {
      return '';
    }
  }
}
