import { Injectable } from '@nestjs/common';
import { BaseScraper } from './base.scraper';
import { ScrapedProduct } from './types';

/**
 * Ulta Beauty (ulta.com) scraper — uses Ulta's internal search/catalog API.
 *
 * Ulta uses Bazaarvoice-powered search; the JSON API is accessible without
 * a browser. Ingredients are on the product detail page in a tab section.
 *
 * 1 USD ≈ 83 INR
 */
const ULTA_CATEGORY_MAP: Record<string, Record<string, string>> = {
  skin: {
    moisturiser: 'moisturizers',
    serum: 'face-serums',
    cleanser: 'face-wash-cleansers',
    toner: 'face-toners',
    'eye-cream': 'eye-treatments',
    sunscreen: 'sunscreen-suncare',
    mask: 'face-mask-treatments',
    exfoliator: 'face-exfoliators',
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
    'hair-mask': 'hair-mask-deep-conditioning',
    'hair-oil': 'hair-oil',
    'hair-serum': 'hair-serum-shine',
    'dry-shampoo': 'dry-shampoo',
    styling: 'styling-products',
  },
  'bath-and-body': {
    'body-lotion': 'body-moisturizer-lotion',
    'body-wash': 'body-wash',
    scrub: 'body-scrub-exfoliating',
    deodorant: 'deodorant',
    'hand-cream': 'hand-cream-lotion',
    'body-oil': 'body-oil',
  },
};

const PRODUCTS_PER_PAGE = 48;
const MAX_PAGES = 2;

@Injectable()
export class UltaScraper extends BaseScraper {
  readonly platform = 'ulta';
  readonly store = 'ulta';
  readonly currency = 'USD';
  protected inrRate = 83;

  protected async scrapeSubcategory(
    category: string,
    subcategory: string,
  ): Promise<ScrapedProduct[]> {
    const categorySlug = ULTA_CATEGORY_MAP[category]?.[subcategory];
    if (!categorySlug) return [];

    const products: ScrapedProduct[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const start = (page - 1) * PRODUCTS_PER_PAGE;
      const url = `https://www.ulta.com/api/catalog/search`;
      const params = {
        Nrpp: PRODUCTS_PER_PAGE,
        No: start,
        N: categorySlug,
        sort: 'sort.toprated',
        format: 'json',
      };

      let data: any;
      try {
        data = await this.fetch(url, {
          params,
          headers: { Referer: `https://www.ulta.com/${categorySlug}` },
        });
      } catch {
        break;
      }

      const records: any[] = data?.records ?? data?.catalog?.productList ?? [];
      if (!records.length) break;

      for (const record of records) {
        const priceUsd = this.extractPrice(record);
        const { ingredients, description } = await this.fetchProductDetail(
          record.productId ?? record.id,
        );

        products.push({
          name: record.displayName ?? record.productName ?? '',
          brand: record.brandName ?? '',
          price: priceUsd,
          currency: 'USD',
          imageUrl: record.imageUrl ?? '',
          platform: this.platform,
          store: this.store,
          category,
          subcategory,
          size: record.size ?? '',
          ingredients,
          description,
          sourceUrl: `https://www.ulta.com/p/${record.productId ?? record.id}`,
          externalId: this.buildExternalId(record.productId ?? record.id),
          scrapedAt: new Date(),
        });

        await this.delay(400);
      }

      if (records.length < PRODUCTS_PER_PAGE) break;
    }

    return products;
  }

  private extractPrice(record: any): number {
    const raw =
      record.regularPrice ??
      record.salePrice ??
      record.priceRange?.min ??
      '0';
    return parseFloat(String(raw).replace(/[^0-9.]/g, '')) || 0;
  }

  /**
   * Ulta product pages are server-rendered; ingredients live in a
   * <section> with data-product-info attribute. We parse them from the HTML.
   */
  private async fetchProductDetail(
    productId: string | number,
  ): Promise<{ ingredients: string; description: string }> {
    try {
      const html: string = await this.fetch(
        `https://www.ulta.com/p/${productId}`,
        { responseType: 'text' },
      );
      const $ = this.load(html);

      // Ingredients section — Ulta renders it as a details/summary block
      const ingredientsRaw =
        $('[data-test="ingredients"]').text().trim() ||
        $('section:contains("Ingredients")').text().replace(/Ingredients/i, '').trim();

      const description =
        $('[data-test="product-description"]').first().text().trim() ||
        $('meta[name="description"]').attr('content') ||
        '';

      return {
        ingredients: ingredientsRaw,
        description: description.slice(0, 1000),
      };
    } catch {
      return { ingredients: '', description: '' };
    }
  }
}
