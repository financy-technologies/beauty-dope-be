/**
 * Full category / subcategory taxonomy used across all scrapers.
 *
 * Each entry maps a canonical category → its subcategories.
 * These strings are stored verbatim in Product.category / .subcategory.
 */
export const CATEGORY_MAP: Record<string, string[]> = {
  skin: [
    'moisturiser',
    'serum',
    'cleanser',
    'toner',
    'eye-cream',
    'sunscreen',
    'mask',
    'exfoliator',
    'anti-aging',
  ],
  makeup: [
    'foundation',
    'concealer',
    'blush',
    'highlighter',
    'eyeshadow',
    'mascara',
    'eyeliner',
    'lipstick',
    'lip-gloss',
    'bronzer',
  ],
  hair: [
    'shampoo',
    'conditioner',
    'hair-mask',
    'hair-oil',
    'hair-serum',
    'dry-shampoo',
    'styling',
  ],
  'bath-and-body': [
    'body-lotion',
    'body-wash',
    'scrub',
    'deodorant',
    'hand-cream',
    'body-oil',
  ],
};

/** A raw product scraped from a platform — before DB persistence. */
export interface ScrapedProduct {
  name: string;
  brand: string;
  price: number;
  currency: string;          // ISO code e.g. "INR", "USD"
  imageUrl?: string;
  platform: string;          // e.g. "nykaa", "sephora"
  store: string;             // same as platform unless a marketplace
  category: string;          // canonical from CATEGORY_MAP
  subcategory: string;       // canonical from CATEGORY_MAP
  size?: string;             // e.g. "50ml", "1.7oz"
  quantity?: number;         // available stock quantity
  ingredients?: string;      // raw INCI string
  description?: string;
  sourceUrl: string;
  externalId: string;        // platform's own product ID / SKU
  scrapedAt: Date;
}

/** One scraper result set returned by a platform scraper. */
export interface ScrapeResult {
  platform: string;
  products: ScrapedProduct[];
  errors: string[];
}
