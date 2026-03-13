/**
 * Tests for BaseScraper utilities — delay, retry, buildExternalId, toInr.
 * We create a minimal concrete subclass to exercise the abstract base.
 */
import { BaseScraper } from './base.scraper';
import { ScrapedProduct } from './types';

class TestScraper extends BaseScraper {
  readonly platform = 'test-platform';
  readonly store = 'test-store';
  readonly currency = 'INR';
  inrRate = 1;

  // Expose protected helpers for testing
  callBuildExternalId(id: string | number) {
    return this.buildExternalId(id);
  }

  callToInr(price: number) {
    return this.toInr(price);
  }

  callLoad(html: string) {
    return this.load(html);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async scrapeSubcategory(_cat: string, _sub: string): Promise<ScrapedProduct[]> {
    return [];
  }
}

describe('BaseScraper utilities', () => {
  let scraper: TestScraper;

  beforeEach(() => {
    scraper = new TestScraper();
    // Skip real delays so iteration tests finish instantly
    jest.spyOn(scraper as any, 'delay').mockResolvedValue(undefined);
  });

  describe('buildExternalId()', () => {
    it('prefixes platform name', () => {
      expect(scraper.callBuildExternalId('abc123')).toBe('test-platform::abc123');
    });

    it('handles numeric IDs', () => {
      expect(scraper.callBuildExternalId(42)).toBe('test-platform::42');
    });
  });

  describe('toInr()', () => {
    it('returns price unchanged when rate is 1', () => {
      scraper.inrRate = 1;
      expect(scraper.callToInr(999)).toBe(999);
    });

    it('converts using inrRate', () => {
      scraper.inrRate = 83;
      expect(scraper.callToInr(10)).toBeCloseTo(830);
    });

    it('rounds to 2 decimal places', () => {
      scraper.inrRate = 83.15;
      const result = scraper.callToInr(9.99);
      expect(result.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    });
  });

  describe('load() — cheerio integration', () => {
    it('parses HTML and finds elements', () => {
      const $ = scraper.callLoad('<div id="target">Hello World</div>');
      expect($('#target').text()).toBe('Hello World');
    });

    it('handles nested selectors', () => {
      const $ = scraper.callLoad('<section><p class="ingredients">Aqua, Glycerin</p></section>');
      expect($('section p.ingredients').text()).toBe('Aqua, Glycerin');
    });

    it('returns empty text for missing selector', () => {
      const $ = scraper.callLoad('<div>nothing</div>');
      expect($('#nonexistent').text()).toBe('');
    });
  });

  describe('scrape() — category iteration', () => {
    it('calls scrapeSubcategory for each category/subcategory combo', async () => {
      const spy = jest
        .spyOn(scraper as any, 'scrapeSubcategory')
        .mockResolvedValue([]);

      await scraper.scrape();

      // CATEGORY_MAP has skin(8) + makeup(10) + hair(7) + bath-and-body(6) = 31 subcategories
      expect(spy).toHaveBeenCalledTimes(31);
    });

    it('filters to requested category only', async () => {
      const spy = jest
        .spyOn(scraper as any, 'scrapeSubcategory')
        .mockResolvedValue([]);

      await scraper.scrape(['skin']);

      // skin has 8 subcategories
      expect(spy).toHaveBeenCalledTimes(8);
    });

    it('continues after a subcategory throws and records the error', async () => {
      jest
        .spyOn(scraper as any, 'scrapeSubcategory')
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValue([]);

      const result = await scraper.scrape(['skin']);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('network timeout');
    });

    it('aggregates products from all categories', async () => {
      const fakeProduct: ScrapedProduct = {
        name: 'Test',
        brand: 'Brand',
        price: 100,
        currency: 'INR',
        platform: 'test-platform',
        store: 'test-store',
        category: 'skin',
        subcategory: 'serum',
        sourceUrl: 'https://example.com/product/1',
        externalId: 'test-platform::1',
        scrapedAt: new Date(),
      };

      jest
        .spyOn(scraper as any, 'scrapeSubcategory')
        .mockResolvedValue([fakeProduct]);

      const result = await scraper.scrape(['skin']);

      // 8 subcategories × 1 product each = 8 products
      expect(result.products.length).toBe(8);
      expect(result.platform).toBe('test-platform');
    });
  });
});
