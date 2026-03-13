/**
 * Unit tests for DupeEngineService.
 *
 * The DB-dependent methods (runFullDetection, upsertCandidates) are tested
 * with an in-memory stub repository so no MySQL connection is needed.
 * The pure algorithmic methods (computeSimilarity, detectInSubcategory) are
 * exercised with real Product-shaped objects.
 */
import { DupeEngineService } from './dupe-engine.service';
import { IngredientParserService } from '../scraping/ingredient-parser.service';
import { Product } from '../products/entities/product.entity';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<Product>): Product {
  const p = new Product();
  p.id = overrides.id ?? 'uuid-1';
  p.name = overrides.name ?? 'Test Product';
  p.brand = overrides.brand ?? 'TestBrand';
  p.price = overrides.price ?? 1000;
  p.currency = overrides.currency ?? 'INR';
  p.normalizedPriceInr = overrides.normalizedPriceInr ?? overrides.price ?? 1000;
  p.category = overrides.category ?? 'skin';
  p.subcategory = overrides.subcategory ?? 'serum';
  p.ingredients = overrides.ingredients ?? null;
  p.ingredientsTokens = overrides.ingredientsTokens ?? [];
  return p;
}

// Stub repositories — no DB needed
const stubDupesRepo: any = {
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn((x) => x),
  save: jest.fn().mockImplementation((x) => Promise.resolve(x)),
  update: jest.fn().mockResolvedValue(undefined),
};

const stubProductsRepo: any = {
  find: jest.fn().mockResolvedValue([]),
};

// ─── Suite ────────────────────────────────────────────────────────────────

describe('DupeEngineService', () => {
  let engine: DupeEngineService;
  let parser: IngredientParserService;

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new IngredientParserService();
    engine = new DupeEngineService(stubDupesRepo, stubProductsRepo, parser);
  });

  // ─── computeSimilarity ──────────────────────────────────────────────────

  describe('computeSimilarity()', () => {
    it('scores identical ingredient lists at 1.0 composite', () => {
      const tokens = ['water', 'glycerin', 'niacinamide', 'retinol', 'hyaluronic-acid'];
      const a = makeProduct({ id: 'a', price: 2000, normalizedPriceInr: 2000, ingredientsTokens: tokens });
      const b = makeProduct({ id: 'b', price: 1000, normalizedPriceInr: 1000, ingredientsTokens: tokens });

      const result = engine.computeSimilarity(a, b, 'serum');

      expect(result.jaccardScore).toBeCloseTo(1);
      expect(result.activesScore).toBeCloseTo(1);
      expect(result.formFactorScore).toBe(1);
      expect(result.compositeScore).toBeCloseTo(1);
    });

    it('scores completely different ingredient lists near 0', () => {
      const a = makeProduct({ id: 'a', price: 2000, normalizedPriceInr: 2000, ingredientsTokens: ['water', 'glycerin'] });
      const b = makeProduct({ id: 'b', price: 1000, normalizedPriceInr: 1000, ingredientsTokens: ['retinol', 'niacinamide', 'avobenzone'] });

      const result = engine.computeSimilarity(a, b, 'serum');

      expect(result.jaccardScore).toBe(0);
      expect(result.compositeScore).toBeLessThan(0.3);
    });

    it('applies form-factor penalty for different subcategories', () => {
      const a = makeProduct({ id: 'a', subcategory: 'serum', ingredientsTokens: ['water', 'niacinamide'] });
      const b = makeProduct({ id: 'b', subcategory: 'moisturiser', ingredientsTokens: ['water', 'niacinamide'] });

      const sameSubcat = engine.computeSimilarity(a, a, 'serum');
      const diffSubcat = engine.computeSimilarity(a, b, 'serum');

      expect(sameSubcat.formFactorScore).toBe(1);
      expect(diffSubcat.formFactorScore).toBe(0.5); // same category, different subcategory
    });

    it('gives high confidence when both products have ≥10 ingredients', () => {
      const tokens = Array.from({ length: 12 }, (_, i) => `ing-${i}`);
      const a = makeProduct({ ingredientsTokens: tokens });
      const b = makeProduct({ ingredientsTokens: tokens });

      const result = engine.computeSimilarity(a, b, 'serum');
      expect(result.confidence).toBe(1);
    });

    it('reduces confidence when products have fewer than 10 ingredients', () => {
      const a = makeProduct({ ingredientsTokens: ['water', 'glycerin'] }); // 2
      const b = makeProduct({ ingredientsTokens: ['water', 'glycerin'] }); // 2

      const result = engine.computeSimilarity(a, b, 'serum');
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('falls back to parsing ingredients string when tokens are absent', () => {
      const a = makeProduct({
        id: 'a',
        price: 2000,
        normalizedPriceInr: 2000,
        ingredientsTokens: [],
        ingredients: 'Aqua, Glycerin, Niacinamide, Sodium Hyaluronate',
      });
      const b = makeProduct({
        id: 'b',
        price: 1000,
        normalizedPriceInr: 1000,
        ingredientsTokens: [],
        ingredients: 'Aqua, Glycerin, Niacinamide, Sodium Hyaluronate, Retinol',
      });

      const result = engine.computeSimilarity(a, b, 'serum');
      // 4 shared / 5 union → jaccard = 0.8
      expect(result.jaccardScore).toBeCloseTo(0.8, 1);
      expect(result.compositeScore).toBeGreaterThan(0.5);
    });
  });

  // ─── detectInSubcategory ────────────────────────────────────────────────

  describe('detectInSubcategory()', () => {
    const highEndTokens = ['water', 'glycerin', 'niacinamide', 'retinol', 'hyaluronic-acid', 'ceramides', 'peptides', 'vitamin-c', 'squalane', 'panthenol'];
    const dupeTokens    = ['water', 'glycerin', 'niacinamide', 'retinol', 'hyaluronic-acid', 'ceramides', 'peptides', 'vitamin-c', 'squalane', 'tocopherol'];

    it('detects a clear dupe pair (high ingredient overlap + big price gap)', () => {
      const luxury = makeProduct({ id: 'luxury', price: 8000, normalizedPriceInr: 8000, ingredientsTokens: highEndTokens });
      const budget = makeProduct({ id: 'budget', price: 800,  normalizedPriceInr: 800,  ingredientsTokens: dupeTokens });

      const candidates = engine.detectInSubcategory([luxury, budget], 'serum');

      expect(candidates.length).toBeGreaterThan(0);
      const top = candidates[0];
      expect(top.original.id).toBe('luxury');  // pricier is original
      expect(top.dupe.id).toBe('budget');
      expect(top.savingsPercent).toBeGreaterThan(80);
      expect(top.similarity.compositeScore).toBeGreaterThan(0.35);
    });

    it('does NOT flag a pair when price difference is below threshold (< 5%)', () => {
      const a = makeProduct({ id: 'a', price: 1000, normalizedPriceInr: 1000, ingredientsTokens: highEndTokens });
      const b = makeProduct({ id: 'b', price: 980,  normalizedPriceInr: 980,  ingredientsTokens: highEndTokens });

      const candidates = engine.detectInSubcategory([a, b], 'serum');
      expect(candidates.length).toBe(0);
    });

    it('does NOT flag a pair when ingredient overlap is too low', () => {
      const a = makeProduct({ id: 'a', price: 5000, normalizedPriceInr: 5000, ingredientsTokens: ['water', 'glycerin'] });
      const b = makeProduct({ id: 'b', price: 500,  normalizedPriceInr: 500,  ingredientsTokens: ['retinol', 'niacinamide', 'avobenzone', 'silicone', 'peptides'] });

      const candidates = engine.detectInSubcategory([a, b], 'serum');
      expect(candidates.length).toBe(0);
    });

    it('ranks candidates by composite score descending', () => {
      const luxury = makeProduct({ id: 'luxury', price: 8000, normalizedPriceInr: 8000, ingredientsTokens: highEndTokens });
      const goodDupe = makeProduct({ id: 'good',  price: 800,  normalizedPriceInr: 800,  ingredientsTokens: dupeTokens }); // ~90% overlap
      const weakDupe = makeProduct({ id: 'weak',  price: 600,  normalizedPriceInr: 600,  ingredientsTokens: ['water', 'glycerin', 'niacinamide'] }); // lower overlap

      const candidates = engine.detectInSubcategory([luxury, goodDupe, weakDupe], 'serum');

      // The good dupe (higher ingredient overlap) should be ranked first
      expect(candidates[0].dupe.id).toBe('good');
    });

    it('orients pairs so original is always more expensive', () => {
      const cheap     = makeProduct({ id: 'cheap',     price: 300,  normalizedPriceInr: 300,  ingredientsTokens: dupeTokens });
      const expensive = makeProduct({ id: 'expensive', price: 5000, normalizedPriceInr: 5000, ingredientsTokens: highEndTokens });

      // Pass cheap first — engine should still orient correctly
      const candidates = engine.detectInSubcategory([cheap, expensive], 'serum');

      if (candidates.length > 0) {
        expect(candidates[0].original.id).toBe('expensive');
        expect(candidates[0].dupe.id).toBe('cheap');
      }
    });

    it('handles subcategory with only one product gracefully', () => {
      const single = makeProduct({ id: 'solo', ingredientsTokens: highEndTokens });
      expect(() => engine.detectInSubcategory([single], 'serum')).not.toThrow();
      expect(engine.detectInSubcategory([single], 'serum')).toEqual([]);
    });

    it('handles products with no ingredient data gracefully', () => {
      const a = makeProduct({ id: 'a', price: 5000, normalizedPriceInr: 5000, ingredientsTokens: [], ingredients: null });
      const b = makeProduct({ id: 'b', price: 500,  normalizedPriceInr: 500,  ingredientsTokens: [], ingredients: null });

      // jaccard(∅, ∅) = 1 but confidence should be 0; pair should still not crash
      expect(() => engine.detectInSubcategory([a, b], 'serum')).not.toThrow();
    });
  });

  // ─── runFullDetection ───────────────────────────────────────────────────

  describe('runFullDetection()', () => {
    it('returns { created: 0, updated: 0 } when no products in DB', async () => {
      stubProductsRepo.find.mockResolvedValueOnce([]);
      const result = await engine.runFullDetection();
      expect(result).toEqual({ created: 0, updated: 0 });
    });

    it('skips products with no ingredient data', async () => {
      const bare = makeProduct({ id: 'bare', ingredients: null, ingredientsTokens: [] });
      stubProductsRepo.find.mockResolvedValueOnce([bare]);

      const result = await engine.runFullDetection();
      expect(result).toEqual({ created: 0, updated: 0 });
    });

    it('creates dupe records for qualifying pairs', async () => {
      const highEnd = makeProduct({
        id: 'luxury',
        subcategory: 'serum',
        price: 8000,
        normalizedPriceInr: 8000,
        ingredientsTokens: ['water', 'glycerin', 'niacinamide', 'retinol', 'hyaluronic-acid', 'ceramides', 'peptides', 'vitamin-c', 'squalane', 'panthenol'],
        ingredients: 'Aqua, Glycerin, Niacinamide, Retinol, Sodium Hyaluronate, Ceramides, Peptides, Vitamin C, Squalane, Panthenol',
      });
      const budget = makeProduct({
        id: 'budget',
        subcategory: 'serum',
        price: 800,
        normalizedPriceInr: 800,
        ingredientsTokens: ['water', 'glycerin', 'niacinamide', 'retinol', 'hyaluronic-acid', 'ceramides', 'peptides', 'vitamin-c', 'squalane', 'tocopherol'],
        ingredients: 'Aqua, Glycerin, Niacinamide, Retinol, Sodium Hyaluronate, Ceramides, Peptides, Vitamin C, Squalane, Tocopherol',
      });

      stubProductsRepo.find.mockResolvedValueOnce([highEnd, budget]);
      stubDupesRepo.findOne.mockResolvedValue(null); // no existing dupe

      const result = await engine.runFullDetection();

      expect(result.created).toBeGreaterThan(0);
      expect(stubDupesRepo.save).toHaveBeenCalled();
    });

    it('updates rather than creates when dupe pair already exists', async () => {
      const highEnd = makeProduct({
        id: 'luxury',
        subcategory: 'serum',
        price: 8000,
        normalizedPriceInr: 8000,
        ingredientsTokens: ['water', 'glycerin', 'niacinamide', 'retinol', 'hyaluronic-acid', 'ceramides', 'peptides', 'vitamin-c', 'squalane', 'panthenol'],
        ingredients: 'existing',
      });
      const budget = makeProduct({
        id: 'budget',
        subcategory: 'serum',
        price: 800,
        normalizedPriceInr: 800,
        ingredientsTokens: ['water', 'glycerin', 'niacinamide', 'retinol', 'hyaluronic-acid', 'ceramides', 'peptides', 'vitamin-c', 'squalane', 'tocopherol'],
        ingredients: 'existing',
      });

      stubProductsRepo.find.mockResolvedValueOnce([highEnd, budget]);
      // Simulate an existing dupe record
      stubDupesRepo.findOne.mockResolvedValue({ id: 'existing-dupe-id' });

      const result = await engine.runFullDetection();

      expect(result.updated).toBeGreaterThan(0);
      expect(result.created).toBe(0);
      expect(stubDupesRepo.update).toHaveBeenCalled();
    });
  });
});
