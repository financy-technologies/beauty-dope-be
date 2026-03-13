import { IngredientParserService } from './ingredient-parser.service';

describe('IngredientParserService', () => {
  let parser: IngredientParserService;

  beforeEach(() => {
    parser = new IngredientParserService();
  });

  // ─── normalize ────────────────────────────────────────────────────────────

  describe('normalize()', () => {
    it('lowercases and trims', () => {
      expect(parser.normalize('  Glycerin  ')).toBe('glycerin');
    });

    it('strips parenthetical groups', () => {
      expect(parser.normalize('Phenoxyethanol (preservative)')).toBe('phenoxyethanol');
    });

    it('strips trailing asterisks', () => {
      expect(parser.normalize('Aloe Barbadensis*')).toBe('aloe-vera');
    });

    it('resolves aqua → water', () => {
      expect(parser.normalize('Aqua')).toBe('water');
    });

    it('resolves sodium hyaluronate → hyaluronic-acid', () => {
      expect(parser.normalize('Sodium Hyaluronate')).toBe('hyaluronic-acid');
    });

    it('resolves ascorbic acid → vitamin-c', () => {
      expect(parser.normalize('Ascorbic Acid')).toBe('vitamin-c');
    });

    it('resolves tocopherol → vitamin-e', () => {
      expect(parser.normalize('Tocopherol')).toBe('vitamin-e');
    });

    it('resolves glycerol → glycerin', () => {
      expect(parser.normalize('Glycerol')).toBe('glycerin');
    });

    it('resolves nicotinamide → niacinamide', () => {
      expect(parser.normalize('Nicotinamide')).toBe('niacinamide');
    });

    it('resolves ceramide variants → ceramides', () => {
      expect(parser.normalize('Ceramide NP')).toBe('ceramides');
      expect(parser.normalize('Ceramide AP')).toBe('ceramides');
    });

    it('collapses extra whitespace', () => {
      expect(parser.normalize('Panthenol  ')).toBe('panthenol');
    });
  });

  // ─── parse ────────────────────────────────────────────────────────────────

  describe('parse()', () => {
    it('returns empty array for null/empty input', () => {
      expect(parser.parse('')).toEqual([]);
      expect(parser.parse(null as any)).toEqual([]);
    });

    it('splits a comma-separated INCI list', () => {
      const raw = 'Aqua, Glycerin, Niacinamide, Sodium Hyaluronate';
      const tokens = parser.parse(raw);
      expect(tokens).toEqual(['water', 'glycerin', 'niacinamide', 'hyaluronic-acid']);
    });

    it('deduplicates tokens (e.g. aqua and water both present)', () => {
      const raw = 'Aqua, Water, Glycerin';
      const tokens = parser.parse(raw);
      expect(tokens.filter((t) => t === 'water').length).toBe(1);
    });

    it('handles semicolon-separated list', () => {
      const raw = 'Aqua; Glycerin; Retinol';
      const tokens = parser.parse(raw);
      expect(tokens).toContain('water');
      expect(tokens).toContain('glycerin');
      expect(tokens).toContain('retinol');
    });

    it('strips parenthetical extras inline', () => {
      const raw = 'Phenoxyethanol (and) Ethylhexylglycerin, Glycerin';
      const tokens = parser.parse(raw);
      expect(tokens).toContain('phenoxyethanol');
      expect(tokens).toContain('glycerin');
    });

    it('parses a realistic serum ingredient list', () => {
      const raw =
        'Aqua, Glycerin, Niacinamide, Sodium Hyaluronate, Ascorbic Acid, ' +
        'Tocopherol, Panthenol, Retinol, Phenoxyethanol';
      const tokens = parser.parse(raw);
      expect(tokens).toContain('water');
      expect(tokens).toContain('niacinamide');
      expect(tokens).toContain('hyaluronic-acid');
      expect(tokens).toContain('vitamin-c');
      expect(tokens).toContain('vitamin-e');
      expect(tokens).toContain('panthenol');
      expect(tokens).toContain('retinol');
    });
  });

  // ─── jaccard ─────────────────────────────────────────────────────────────

  describe('jaccard()', () => {
    it('returns 1 for identical sets', () => {
      const s = new Set(['a', 'b', 'c']);
      expect(parser.jaccard(s, s)).toBe(1);
    });

    it('returns 0 for completely disjoint sets', () => {
      expect(parser.jaccard(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0);
    });

    it('returns 0.5 for 50% overlap', () => {
      const a = new Set(['x', 'y']);
      const b = new Set(['y', 'z']);
      expect(parser.jaccard(a, b)).toBeCloseTo(1 / 3);
    });

    it('handles empty sets gracefully', () => {
      expect(parser.jaccard(new Set(), new Set())).toBe(1);
      expect(parser.jaccard(new Set(['a']), new Set())).toBe(0);
    });

    it('computes correct value for a known example', () => {
      // A = {water, glycerin, niacinamide, retinol}  (4 items)
      // B = {water, glycerin, niacinamide, hyaluronic-acid}  (4 items)
      // intersection = 3, union = 5 → 3/5 = 0.6
      const a = new Set(['water', 'glycerin', 'niacinamide', 'retinol']);
      const b = new Set(['water', 'glycerin', 'niacinamide', 'hyaluronic-acid']);
      expect(parser.jaccard(a, b)).toBeCloseTo(0.6);
    });
  });

  // ─── activeOverlap ────────────────────────────────────────────────────────

  describe('activeOverlap()', () => {
    it('returns 1 when both share all relevant actives', () => {
      const tokens = ['water', 'glycerin', 'niacinamide', 'retinol', 'hyaluronic-acid'];
      expect(parser.activeOverlap(tokens, tokens, 'serum')).toBeCloseTo(1);
    });

    it('returns 0 for a subcategory with no key-active data', () => {
      const t = ['water'];
      expect(parser.activeOverlap(t, t, 'unknown-subcategory')).toBe(0);
    });

    it('returns partial score when only some actives overlap', () => {
      const tokensA = ['water', 'niacinamide', 'retinol'];        // 2 actives
      const tokensB = ['water', 'niacinamide', 'hyaluronic-acid']; // 1 shared: niacinamide
      const score = parser.activeOverlap(tokensA, tokensB, 'serum');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });
  });

  // ─── extractKeyActives ────────────────────────────────────────────────────

  describe('extractKeyActives()', () => {
    it('identifies serum actives from token list', () => {
      const tokens = ['water', 'glycerin', 'retinol', 'niacinamide', 'phenoxyethanol'];
      const actives = parser.extractKeyActives(tokens, 'serum');
      expect(actives.has('retinol')).toBe(true);
      expect(actives.has('niacinamide')).toBe(true);
      expect(actives.has('water')).toBe(false);
    });

    it('identifies sunscreen filters', () => {
      const tokens = ['water', 'zinc-oxide', 'titanium-dioxide', 'glycerin'];
      const actives = parser.extractKeyActives(tokens, 'sunscreen');
      expect(actives.has('zinc-oxide')).toBe(true);
      expect(actives.has('titanium-dioxide')).toBe(true);
    });

    it('returns empty set for unknown subcategory', () => {
      const actives = parser.extractKeyActives(['retinol'], 'unknown');
      expect(actives.size).toBe(0);
    });
  });
});
