import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dupe } from './entities/dupe.entity';
import { Product } from '../products/entities/product.entity';
import { IngredientParserService } from '../scraping/ingredient-parser.service';

const SCORE_VERSION = '2.0';

/**
 * Composite similarity weights
 *
 *  50%  — Jaccard similarity across full ingredient lists
 *  40%  — Key-active overlap (subcategory-specific power ingredients)
 *  10%  — Form-factor / subcategory match
 *
 * Quality gates (applied before scoring):
 *  - Both products must have ≥ MIN_TOKENS ingredient tokens
 *  - Price difference must be 20–800% (meaningful savings, not absurd gap)
 *  - Same brand pairs are skipped (want cross-brand dupes only)
 *
 * Acceptance threshold: compositeScore >= 0.55
 *
 * Tier labels:
 *  exact-match   score >= 0.85
 *  close-dupe    score >= 0.70
 *  inspired-by   score >= 0.55
 */
const WEIGHTS         = { jaccard: 0.50, actives: 0.40, formFactor: 0.10 } as const;
const MIN_TOKENS      = 8;    // minimum ingredient tokens to be comparable
const MIN_SAVINGS_PCT = 20;   // at least 20% cheaper to qualify
const MAX_PRICE_RATIO = 8;    // original must not be >8x the dupe (different tier)
const DUPE_THRESHOLD  = 0.55; // minimum composite score
const BATCH_SAVE_SIZE = 50;

interface SimilarityResult {
  jaccardScore:    number;
  activesScore:    number;
  formFactorScore: number;
  compositeScore:  number;
  confidence:      number;
  sharedActives:   string[];
}

interface DupeCandidate {
  original:       Product;
  dupe:           Product;
  savingsPercent: number;
  priceRatio:     number;
  similarity:     SimilarityResult;
}

@Injectable()
export class DupeEngineService {
  private readonly logger = new Logger(DupeEngineService.name);

  constructor(
    @InjectRepository(Dupe)
    private readonly dupesRepo: Repository<Dupe>,
    @InjectRepository(Product)
    private readonly productsRepo: Repository<Product>,
    private readonly parser: IngredientParserService,
  ) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  async previewDetection(subcategoryFilter?: string): Promise<object[]> {
    const eligible = await this.loadEligibleProducts();
    const bySubcategory = this.groupBySubcategory(eligible);
    const results: object[] = [];

    for (const [subcategory, products] of bySubcategory.entries()) {
      if (subcategoryFilter && subcategory !== subcategoryFilter.toLowerCase()) continue;

      const candidates = this.detectInSubcategory(products, subcategory);
      for (const cand of candidates) {
        results.push({
          subcategory,
          label:         this.dupeLabel(cand.similarity.compositeScore),
          compositeScore: parseFloat(cand.similarity.compositeScore.toFixed(3)),
          jaccardScore:   parseFloat(cand.similarity.jaccardScore.toFixed(3)),
          activesScore:   parseFloat(cand.similarity.activesScore.toFixed(3)),
          confidence:     cand.similarity.confidence,
          savingsPercent: Math.round(cand.savingsPercent),
          priceRatio:     parseFloat(cand.priceRatio.toFixed(2)),
          sharedActives:  cand.similarity.sharedActives,
          original: {
            id:    cand.original.id,
            name:  cand.original.name,
            brand: cand.original.brand,
            price: Number(cand.original.normalizedPriceInr ?? cand.original.price),
          },
          dupe: {
            id:    cand.dupe.id,
            name:  cand.dupe.name,
            brand: cand.dupe.brand,
            price: Number(cand.dupe.normalizedPriceInr ?? cand.dupe.price),
          },
        });
      }
    }

    return results.sort((a: any, b: any) => b.compositeScore - a.compositeScore);
  }

  parseIngredients(raw: string, subcategory: string): object {
    const tokens  = this.parser.parse(raw);
    const actives = this.parser.extractKeyActives(tokens, subcategory);
    return { totalTokens: tokens.length, tokens, keyActives: [...actives] };
  }

  async runFullDetection(): Promise<{ created: number; updated: number }> {
    this.logger.log('Starting full dupe detection run (v2)…');

    const eligible      = await this.loadEligibleProducts();
    const bySubcategory = this.groupBySubcategory(eligible);

    let created = 0;
    let updated = 0;

    for (const [subcategory, products] of bySubcategory.entries()) {
      this.logger.debug(
        `Detecting dupes in ${subcategory} (${products.length} eligible products)`,
      );
      const candidates = this.detectInSubcategory(products, subcategory);
      const ranked      = this.rankByOriginal(candidates);
      const { c, u }   = await this.upsertCandidates(ranked, subcategory);
      created += c;
      updated += u;
    }

    this.logger.log(`Done. Created: ${created}, Updated: ${updated}`);
    return { created, updated };
  }

  async rescoreDupe(dupeId: string): Promise<void> {
    const dupe = await this.dupesRepo.findOne({
      where: { id: dupeId },
      relations: ['originalProduct', 'dupeProduct'],
    });
    if (!dupe) return;

    const subcategory = dupe.originalProduct.subcategory ?? dupe.dupeProduct.subcategory ?? '';
    const sim = this.computeSimilarity(dupe.originalProduct, dupe.dupeProduct, subcategory);

    await this.dupesRepo.update(dupeId, {
      similarityScore:  Math.round(sim.compositeScore * 100),
      dupeLabel:        this.dupeLabel(sim.compositeScore),
      sharedActives:    sim.sharedActives,
      scoringMethod:    'jaccard+actives+form-v2',
      scoreConfidence:  sim.confidence,
      scoreVersion:     SCORE_VERSION,
      scoreCalculatedAt: new Date(),
    });
  }

  // ─── Core Algorithm ───────────────────────────────────────────────────────

  computeSimilarity(a: Product, b: Product, subcategory: string): SimilarityResult {
    const tokensA = this.ensureTokens(a);
    const tokensB = this.ensureTokens(b);

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);

    const jaccardScore    = this.parser.jaccard(setA, setB);
    const activesScore    = this.parser.activeOverlap(tokensA, tokensB, subcategory);
    const formFactorScore = this.formFactorScore(a, b);

    const compositeScore =
      WEIGHTS.jaccard * jaccardScore +
      WEIGHTS.actives * activesScore +
      WEIGHTS.formFactor * formFactorScore;

    const confidence   = this.computeConfidence(tokensA.length, tokensB.length);
    const sharedActives = this.computeSharedActives(tokensA, tokensB, subcategory);

    return { jaccardScore, activesScore, formFactorScore, compositeScore, confidence, sharedActives };
  }

  detectInSubcategory(products: Product[], subcategory: string): DupeCandidate[] {
    const candidates: DupeCandidate[] = [];

    for (let i = 0; i < products.length; i++) {
      for (let j = i + 1; j < products.length; j++) {
        const a = products[i];
        const b = products[j];

        // ── Quality gates ──────────────────────────────────────────────────
        // Skip same brand — we want cross-brand dupes
        if (a.brand?.toLowerCase() === b.brand?.toLowerCase()) continue;

        const priceA    = Number(a.normalizedPriceInr ?? a.price);
        const priceB    = Number(b.normalizedPriceInr ?? b.price);
        if (!priceA || !priceB) continue;

        const [higherPrice, lowerPrice] =
          priceA >= priceB ? [priceA, priceB] : [priceB, priceA];

        const savingsPercent = ((higherPrice - lowerPrice) / higherPrice) * 100;
        const priceRatio     = higherPrice / lowerPrice;

        // Must save at least MIN_SAVINGS_PCT%
        if (savingsPercent < MIN_SAVINGS_PCT) continue;
        // Reject absurdly priced pairs (completely different market)
        if (priceRatio > MAX_PRICE_RATIO) continue;

        // ── Score ──────────────────────────────────────────────────────────
        const sim = this.computeSimilarity(a, b, subcategory);
        if (sim.compositeScore < DUPE_THRESHOLD) continue;

        const [original, dupe] = priceA >= priceB ? [a, b] : [b, a];

        candidates.push({ original, dupe, savingsPercent, priceRatio, similarity: sim });
      }
    }

    return candidates.sort((x, y) => {
      const diff = y.similarity.compositeScore - x.similarity.compositeScore;
      return diff !== 0 ? diff : y.savingsPercent - x.savingsPercent;
    });
  }

  // ─── Ranking ──────────────────────────────────────────────────────────────

  /**
   * Group candidates by original product, assign dupeRank within each group.
   * The best dupe (rank 1) gets isFeatured = true.
   */
  private rankByOriginal(candidates: DupeCandidate[]): (DupeCandidate & { rank: number; featured: boolean })[] {
    const grouped = new Map<string, DupeCandidate[]>();

    for (const c of candidates) {
      const key = c.original.id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    }

    const ranked: (DupeCandidate & { rank: number; featured: boolean })[] = [];

    for (const group of grouped.values()) {
      // Already sorted by score — assign rank
      group.forEach((c, idx) => {
        ranked.push({ ...c, rank: idx + 1, featured: idx === 0 });
      });
    }

    return ranked;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async loadEligibleProducts(): Promise<Product[]> {
    const all = await this.productsRepo.find({
      select: [
        'id', 'name', 'brand', 'price', 'currency', 'normalizedPriceInr',
        'category', 'subcategory', 'ingredients', 'ingredientsTokens',
      ],
    });
    return all.filter((p) => {
      const tokens = this.ensureTokens(p);
      return tokens.length >= MIN_TOKENS;
    });
  }

  private groupBySubcategory(products: Product[]): Map<string, Product[]> {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      const key = (p.subcategory ?? 'unknown').toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }

  private ensureTokens(product: Product): string[] {
    if (product.ingredientsTokens?.length) return product.ingredientsTokens;
    if (product.ingredients) return this.parser.parse(product.ingredients);
    return [];
  }

  private dupeLabel(score: number): string {
    if (score >= 0.85) return 'exact-match';
    if (score >= 0.70) return 'close-dupe';
    return 'inspired-by';
  }

  private formFactorScore(a: Product, b: Product): number {
    if (!a.subcategory || !b.subcategory) return 0.5;
    if (a.subcategory.toLowerCase() === b.subcategory.toLowerCase()) return 1.0;
    if (a.category?.toLowerCase() === b.category?.toLowerCase()) return 0.5;
    return 0;
  }

  private computeSharedActives(tokensA: string[], tokensB: string[], subcategory: string): string[] {
    const setA    = new Set(tokensA);
    const setB    = new Set(tokensB);
    const actives = this.parser.extractKeyActives(tokensA, subcategory);
    return [...actives].filter((a) => setA.has(a) && setB.has(a));
  }

  private computeConfidence(lenA: number, lenB: number): number {
    const MIN   = 10;
    const ratio = (Math.min(lenA, MIN) + Math.min(lenB, MIN)) / (2 * MIN);
    return parseFloat(ratio.toFixed(2));
  }

  private async upsertCandidates(
    candidates: (DupeCandidate & { rank: number; featured: boolean })[],
    subcategory: string,
  ): Promise<{ c: number; u: number }> {
    let c = 0;
    let u = 0;

    for (let i = 0; i < candidates.length; i += BATCH_SAVE_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SAVE_SIZE);

      for (const cand of batch) {
        const existing = await this.dupesRepo.findOne({
          where: {
            originalProduct: { id: cand.original.id },
            dupeProduct:     { id: cand.dupe.id },
          },
        });

        const scoreInt = Math.round(cand.similarity.compositeScore * 100);
        const now      = new Date();
        const category = cand.original.category ?? cand.dupe.category ?? subcategory;

        if (existing) {
          await this.dupesRepo.update(existing.id, {
            similarityScore:   scoreInt,
            savingsPercent:    Math.round(cand.savingsPercent),
            priceRatio:        parseFloat(cand.priceRatio.toFixed(2)),
            dupeRank:          cand.rank,
            dupeLabel:         this.dupeLabel(cand.similarity.compositeScore),
            sharedActives:     cand.similarity.sharedActives,
            isFeatured:        cand.featured,
            scoringMethod:     'jaccard+actives+form-v2',
            scoreConfidence:   cand.similarity.confidence,
            scoreVersion:      SCORE_VERSION,
            scoreCalculatedAt: now,
          });
          u++;
        } else {
          const newDupe = this.dupesRepo.create({
            originalProduct:   cand.original,
            dupeProduct:       cand.dupe,
            similarityScore:   scoreInt,
            savingsPercent:    Math.round(cand.savingsPercent),
            priceRatio:        parseFloat(cand.priceRatio.toFixed(2)),
            dupeRank:          cand.rank,
            dupeLabel:         this.dupeLabel(cand.similarity.compositeScore),
            sharedActives:     cand.similarity.sharedActives,
            category,
            isFeatured:        cand.featured,
            isTrending:        false,
            scoringMethod:     'jaccard+actives+form-v2',
            scoreConfidence:   cand.similarity.confidence,
            scoreVersion:      SCORE_VERSION,
            scoreCalculatedAt: now,
          });
          await this.dupesRepo.save(newDupe);
          c++;
        }
      }
    }

    return { c, u };
  }
}
