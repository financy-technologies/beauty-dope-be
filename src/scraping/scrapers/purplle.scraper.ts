import { Injectable } from '@nestjs/common';
import { BaseScraper } from './base.scraper';
import { ScrapedProduct } from './types';

/**
 * Purplle.com scraper — major Indian beauty marketplace.
 * Uses Purplle's Algolia-backed search API (same calls the site makes).
 * Ingredients are available on the product detail API.
 *
 * Native currency: INR.
 */
const PURPLLE_CATEGORY_SLUGS: Record<string, Record<string, string>> = {
  skin: {
    moisturiser: 'skin-care/moisturizers',
    serum: 'skin-care/face-serum',
    cleanser: 'skin-care/face-wash',
    toner: 'skin-care/toners',
    'eye-cream': 'skin-care/eye-cream',
    sunscreen: 'skin-care/sunscreen',
    mask: 'skin-care/face-mask',
    exfoliator: 'skin-care/scrub-exfoliants',
  },
  makeup: {
    foundation: 'makeup/foundation',
    concealer: 'makeup/concealer',
    blush: 'makeup/blusher',
    highlighter: 'makeup/highlighter',
    eyeshadow: 'makeup/eye-shadow',
    mascara: 'makeup/mascara',
    eyeliner: 'makeup/eyeliner',
    lipstick: 'makeup/lipstick',
    'lip-gloss': 'makeup/lip-gloss',
    bronzer: 'makeup/bronzer-contour',
  },
  hair: {
    shampoo: 'hair-care/shampoo',
    conditioner: 'hair-care/conditioner',
    'hair-mask': 'hair-care/hair-mask',
    'hair-oil': 'hair-care/hair-oils',
    'hair-serum': 'hair-care/hair-serum',
    'dry-shampoo': 'hair-care/dry-shampoo',
    styling: 'hair-care/hair-styling-products',
  },
  'bath-and-body': {
    'body-lotion': 'bath-body/body-lotion',
    'body-wash': 'bath-body/shower-gel',
    scrub: 'bath-body/body-scrub',
    deodorant: 'bath-body/deodorant',
    'hand-cream': 'bath-body/hand-cream',
    'body-oil': 'bath-body/body-oil',
  },
};

const PRODUCTS_PER_PAGE = 40;
const MAX_PAGES = 3;

@Injectable()
export class PurplleScraper extends BaseScraper {
  readonly platform = 'purplle';
  readonly store = 'purplle';
  readonly currency = 'INR';
  protected inrRate = 1;

  protected async scrapeSubcategory(
    category: string,
    subcategory: string,
  ): Promise<ScrapedProduct[]> {
    const slug = PURPLLE_CATEGORY_SLUGS[category]?.[subcategory];
    if (!slug) return [];

    const products: ScrapedProduct[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `https://www.purplle.com/api/v3/category-listing`;
      const params = {
        slug,
        page,
        per_page: PRODUCTS_PER_PAGE,
        sort: 'popularity',
      };

      let data: any;
      try {
        data = await this.fetch(url, {
          params,
          headers: {
            Referer: `https://www.purplle.com/${slug}`,
            'x-app-version': '4.0',
          },
        });
      } catch {
        break;
      }

      const items: any[] = data?.data?.products ?? data?.products ?? [];
      if (!items.length) break;

      for (const item of items) {
        const detail = await this.fetchProductDetail(item.id ?? item.product_id);

        products.push({
          name: item.name ?? item.product_name ?? '',
          brand: item.brand ?? item.brand_name ?? '',
          price: parseFloat(item.price ?? item.discounted_price ?? item.mrp ?? '0'),
          currency: 'INR',
          imageUrl: item.image ?? item.primary_image ?? '',
          platform: this.platform,
          store: this.store,
          category,
          subcategory,
          size: item.size ?? item.quantity ?? '',
          ingredients: detail?.ingredients ?? '',
          description: detail?.description ?? item.short_description ?? '',
          sourceUrl: `https://www.purplle.com/product/${item.slug ?? item.id}`,
          externalId: this.buildExternalId(item.id ?? item.product_id),
          scrapedAt: new Date(),
        });

        await this.delay(400);
      }

      if (items.length < PRODUCTS_PER_PAGE) break;
    }

    return products;
  }

  private async fetchProductDetail(
    productId: string | number,
  ): Promise<{ ingredients: string; description: string } | null> {
    try {
      const url = `https://www.purplle.com/api/v3/products/${productId}`;
      const data: any = await this.fetch(url);
      const product = data?.data ?? data?.product ?? {};

      const rawIngredients: string =
        product.ingredients ??
        product.key_ingredients ??
        '';

      const description: string =
        (product.description ?? product.short_description ?? '')
          .replace(/<[^>]+>/g, '')
          .trim();

      return { ingredients: rawIngredients, description };
    } catch {
      return null;
    }
  }
}
