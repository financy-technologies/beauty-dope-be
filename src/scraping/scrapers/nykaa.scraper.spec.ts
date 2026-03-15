/**
 * Unit tests for NykaaScraper — focused on quantity extraction and
 * the product-mapping logic inside fetchPages().
 *
 * All network calls are mocked so no real HTTP is needed.
 */
import { NykaaScraper } from './nykaa.scraper';
import { ScrapedProduct } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Builds a minimal Nykaa API listing response */
function listingResponse(products: object[]): object {
  return {
    status: 'success',
    response: { products },
  };
}

/** Minimal Nykaa API product item with all required fields */
function apiItem(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id:           1001,
    name:         'Test Moisturiser',
    brand_name:   'TestBrand',
    final_price:  '499',
    slug:         'testbrand/test-moisturiser/p/1001',
    pack_size:    '50ml',
    new_image_url:'https://cdn.nykaa.com/img/1001.jpg',
    primary_categories: { l3: { name: 'Moisturizers' }, l2: { name: 'Skin Care' } },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('NykaaScraper', () => {
  let scraper: NykaaScraper;

  beforeEach(() => {
    scraper = new NykaaScraper();
    // Silence logger noise in test output
    jest.spyOn((scraper as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((scraper as any).logger, 'debug').mockImplementation(() => {});
    // Skip polite delay so tests finish quickly
    jest.spyOn(scraper as any, 'delay').mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  // ── parseQuantity ────────────────────────────────────────────────────────

  describe('parseQuantity()', () => {
    const parse = (v: any) => (scraper as any).parseQuantity(v);

    it('parses an integer string', () => {
      expect(parse('5')).toBe(5);
    });

    it('parses a numeric value', () => {
      expect(parse(42)).toBe(42);
    });

    it('parses zero correctly', () => {
      expect(parse(0)).toBe(0);
    });

    it('returns undefined for null', () => {
      expect(parse(null)).toBeUndefined();
    });

    it('returns undefined for undefined', () => {
      expect(parse(undefined)).toBeUndefined();
    });

    it('returns undefined for non-numeric string', () => {
      expect(parse('available')).toBeUndefined();
    });

    it('truncates decimal values to integer', () => {
      expect(parse('10.9')).toBe(10);
    });
  });

  // ── fetchPages — quantity field fallback chain ────────────────────────────

  describe('scrapeSubcategory() — quantity field mapping', () => {
    /** Mocks fetch: first call returns listing JSON, subsequent calls for ingredients return ''. */
    function mockFetch(item: Record<string, any>) {
      jest
        .spyOn(scraper as any, 'fetch')
        .mockResolvedValueOnce(listingResponse([item]))       // listing page
        .mockResolvedValue('');                               // ingredient page + subsequent pages
    }

    async function scrapeOne(item: Record<string, any>): Promise<ScrapedProduct> {
      mockFetch(item);
      const products = await (scraper as any).scrapeSubcategory('makeup', 'foundation');
      return products[0];
    }

    it('reads quantity from item.quantity', async () => {
      const p = await scrapeOne(apiItem({
        primary_categories: { l3: { name: 'Foundation' }, l2: { name: 'Makeup' } },
        quantity: 15,
      }));
      expect(p.quantity).toBe(15);
    });

    it('falls back to item.qty when item.quantity is absent', async () => {
      const p = await scrapeOne(apiItem({
        primary_categories: { l3: { name: 'Foundation' }, l2: { name: 'Makeup' } },
        qty: 8,
      }));
      expect(p.quantity).toBe(8);
    });

    it('falls back to item.stock_qty', async () => {
      const p = await scrapeOne(apiItem({
        primary_categories: { l3: { name: 'Foundation' }, l2: { name: 'Makeup' } },
        stock_qty: 3,
      }));
      expect(p.quantity).toBe(3);
    });

    it('falls back to item.stockQty', async () => {
      const p = await scrapeOne(apiItem({
        primary_categories: { l3: { name: 'Foundation' }, l2: { name: 'Makeup' } },
        stockQty: 20,
      }));
      expect(p.quantity).toBe(20);
    });

    it('stores undefined when no quantity field is present', async () => {
      const p = await scrapeOne(apiItem({
        primary_categories: { l3: { name: 'Foundation' }, l2: { name: 'Makeup' } },
      }));
      expect(p.quantity).toBeUndefined();
    });

    it('stores zero when quantity is explicitly 0 (out of stock)', async () => {
      const p = await scrapeOne(apiItem({
        primary_categories: { l3: { name: 'Foundation' }, l2: { name: 'Makeup' } },
        quantity: 0,
      }));
      expect(p.quantity).toBe(0);
    });
  });

  // ── fetchPages — other product fields still correct ──────────────────────

  describe('scrapeSubcategory() — core product fields', () => {
    it('maps name, brand, price, size, currency, platform, externalId', async () => {
      const item = apiItem({
        primary_categories: { l3: { name: 'Foundation' }, l2: { name: 'Makeup' } },
        quantity: 12,
      });

      jest
        .spyOn(scraper as any, 'fetch')
        .mockResolvedValueOnce(listingResponse([item]))
        .mockResolvedValue('');

      const products = await (scraper as any).scrapeSubcategory('makeup', 'foundation');
      expect(products).toHaveLength(1);

      const p: ScrapedProduct = products[0];
      expect(p.name).toBe('Test Moisturiser');
      expect(p.brand).toBe('TestBrand');
      expect(p.price).toBe(499);
      expect(p.currency).toBe('INR');
      expect(p.size).toBe('50ml');
      expect(p.platform).toBe('nykaa');
      expect(p.externalId).toBe('nykaa::1001');
      expect(p.sourceUrl).toContain('nykaa.com');
      expect(p.quantity).toBe(12);
    });

    it('returns empty array when API status is not success', async () => {
      jest.spyOn(scraper as any, 'fetch').mockResolvedValue({ status: 'failed', response: {} });

      const products = await (scraper as any).scrapeSubcategory('makeup', 'foundation');
      expect(products).toHaveLength(0);
    });

    it('returns empty array when products list is empty', async () => {
      jest
        .spyOn(scraper as any, 'fetch')
        .mockResolvedValue({ status: 'success', response: { products: [] } });

      const products = await (scraper as any).scrapeSubcategory('makeup', 'foundation');
      expect(products).toHaveLength(0);
    });
  });
});
