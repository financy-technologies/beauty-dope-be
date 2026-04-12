import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dupe } from './entities/dupe.entity';
import { Product } from '../products/entities/product.entity';
import { IngredientParserService } from '../scraping/ingredient-parser.service';

const SCORE_VERSION = '3.0';

/**
 * ── Skin Signal Dupe Engine v3 ────────────────────────────────────────────────
 *
 * Seven-component composite scorer that mirrors how a cosmetic chemist would
 * manually evaluate whether product B is a true dupe for product A.
 *
 * ┌──────────────────────────────────┬────────┬───────────────────────────────────────────────┐
 * │ Component                        │ Weight │ What it measures                              │
 * ├──────────────────────────────────┼────────┼───────────────────────────────────────────────┤
 * │ Active Recall                    │  35%   │ Fraction of original's key actives replicated  │
 * │                                  │        │ by dupe (functional equivalents count at 0.7×) │
 * │ Position-Weighted Jaccard        │  25%   │ Full-formula similarity but ingredients at     │
 * │                                  │        │ position 1–5 (highest concentration) weighted  │
 * │                                  │        │ exponentially more than position 25+           │
 * │ Mechanism-of-Action Similarity   │  20%   │ Overlap in WHAT the products do (collagen      │
 * │                                  │        │ synthesis, brightening, barrier-repair, …).    │
 * │                                  │        │ Two products can share no tokens but still      │
 * │                                  │        │ target the same mechanism via different         │
 * │                                  │        │ ingredients (e.g. retinol ↔ bakuchiol)         │
 * │ Price Efficiency                 │  10%   │ Bell-curve centered at 2–4× ratio; barely-     │
 * │                                  │        │ cheaper and absurdly-cheap both score lower    │
 * │ Safety Profile Match             │   5%   │ Fungal-acne safe + pregnancy-safe agreement     │
 * │ Form Factor / Subcategory        │   5%   │ Same subcategory = 1.0, same category = 0.5   │
 * ├──────────────────────────────────┼────────┼───────────────────────────────────────────────┤
 * │ − Critical Active Penalty        │ −0–20% │ If original has a defining active (retinol     │
 * │                                  │        │ in anti-aging serum, SPF filters in sunscreen) │
 * │                                  │        │ and dupe has NO functional equivalent → hard   │
 * │                                  │        │ deduction                                      │
 * └──────────────────────────────────┴────────┴───────────────────────────────────────────────┘
 *
 * Concern-based pairing: before scoring, the engine classifies each product's
 * primary skin concern (brightening / anti-aging / hydration / acne / barrier / spf).
 * Products with incompatible concerns are penalised via a concern-compatibility
 * multiplier (0.6–1.0) applied to the final score.
 *
 * ── Thresholds ────────────────────────────────────────────────────────────────
 *   exact-match   score >= 0.82   (identical efficacy profile)
 *   close-dupe    score >= 0.67   (strong functional overlap, minor differences)
 *   inspired-by   score >= 0.70   (minimum bar — must clear DUPE_THRESHOLD)
 *
 * ── Price gates ───────────────────────────────────────────────────────────────
 *   Minimum savings:  20%  (dupe must be at least 20% cheaper)
 *   Maximum ratio:     8×  (beyond this, products are in different market tiers)
 */

const WEIGHTS = {
  activeRecall:      0.35,
  posJaccard:        0.25,
  mechanism:         0.20,
  priceEfficiency:   0.10,
  safetyProfile:     0.05,
  formFactor:        0.05,
} as const;

const MIN_TOKENS       = 8;
const MIN_SAVINGS_PCT  = 20;
const MAX_PRICE_RATIO  = 8;
const DUPE_THRESHOLD   = 0.70;   // raised from 0.52 — only strong matches qualify
const BATCH_SAVE_SIZE  = 50;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface SimilarityResult {
  // v2 compat fields (kept for existing API consumers)
  jaccardScore:    number;
  activesScore:    number;
  formFactorScore: number;
  compositeScore:  number;
  confidence:      number;
  sharedActives:   string[];

  // v3 diagnostic fields
  activeRecallScore:       number;
  positionWeightedJaccard: number;
  mechanismScore:          number;
  priceEfficiencyScore:    number;
  safetyMatchScore:        number;
  missingActivePenalty:    number;
  activeOverlapPct:        number;   // 0–100 integer
  missingActives:          string[]; // actives in original that dupe lacks
  primaryConcernA:         string | null;
  primaryConcernB:         string | null;
  concernMultiplier:       number;
}

interface DupeCandidate {
  original:       Product;
  dupe:           Product;
  savingsPercent: number;
  priceRatio:     number;
  similarity:     SimilarityResult;
}

// ─── Service ──────────────────────────────────────────────────────────────────

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

  // ─── Public API ─────────────────────────────────────────────────────────────

  async previewDetection(subcategoryFilter?: string): Promise<object[]> {
    const eligible      = await this.loadEligibleProducts();
    const bySubcategory = this.groupBySubcategory(eligible);
    const results: object[] = [];

    for (const [subcategory, products] of bySubcategory.entries()) {
      if (subcategoryFilter && subcategory !== subcategoryFilter.toLowerCase()) continue;

      const candidates = this.detectInSubcategory(products, subcategory);
      for (const cand of candidates) {
        results.push(this.candidateToPreview(cand, subcategory));
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
    this.logger.log('Starting full dupe detection run (v3 — Skin Signal)…');

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
      this.logger.debug(
        `  ${subcategory}: ${candidates.length} dupes found — saved ${c} new, updated ${u}`,
      );
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
    const priceA = Number(dupe.originalProduct.normalizedPriceInr ?? dupe.originalProduct.price);
    const priceB = Number(dupe.dupeProduct.normalizedPriceInr    ?? dupe.dupeProduct.price);
    const priceRatio = priceA > priceB && priceB > 0 ? priceA / priceB : 1;

    const sim = this.computeSimilarityV3(
      dupe.originalProduct, dupe.dupeProduct, subcategory, priceRatio,
    );

    await this.dupesRepo.update(dupeId, {
      similarityScore:    Math.round(sim.compositeScore * 100),
      dupeLabel:          this.dupeLabel(sim.compositeScore),
      sharedActives:      sim.sharedActives,
      scoringMethod:      'v3-skin-signal',
      scoreConfidence:    sim.confidence,
      scoreVersion:       SCORE_VERSION,
      scoreCalculatedAt:  new Date(),
      mechanismScore:     parseFloat(sim.mechanismScore.toFixed(3)),
      activeOverlapPct:   sim.activeOverlapPct,
      missingActives:     sim.missingActives,
      primaryConcern:     sim.primaryConcernA ?? undefined,
    });
  }

  // ─── Core Algorithm ──────────────────────────────────────────────────────────

  /**
   * v3 composite similarity.
   *
   * priceRatio is required because the price-efficiency component is part
   * of the score (not just a gate). Pass originalPrice / dupePrice.
   */
  computeSimilarityV3(
    original: Product,
    dupe: Product,
    subcategory: string,
    priceRatio: number,
  ): SimilarityResult {
    const tokensA = this.ensureTokens(original);
    const tokensB = this.ensureTokens(dupe);

    // ── Component scores ──────────────────────────────────────────────────────

    // 1. Active Recall — how much of original's efficacy does dupe replicate?
    const activeRecall = this.parser.activeRecallScore(tokensA, tokensB, subcategory);

    // 2. Position-Weighted Jaccard — full-formula similarity weighted by concentration order
    const posJaccard = this.parser.positionWeightedJaccard(tokensA, tokensB);

    // 3. Mechanism-of-Action Similarity — what does each product DO?
    const mechanismSim = this.parser.mechanismSimilarity(tokensA, tokensB);

    // 4. Price Efficiency — bell-curve around 2–4× price ratio
    const priceEfficiency = this.parser.priceEfficiencyScore(priceRatio);

    // 5. Safety Profile Match — fungalAcneSafe + pregnancySafe agreement
    const safetyMatch = this.parser.safetyProfileScore(
      original.ingredientBreakdown?.fungalAcneSafe,
      dupe.ingredientBreakdown?.fungalAcneSafe,
      original.ingredientBreakdown?.pregnancySafe,
      dupe.ingredientBreakdown?.pregnancySafe,
    );

    // 6. Form Factor
    const formFactor = this.formFactorScore(original, dupe);

    // ── Weighted sum ──────────────────────────────────────────────────────────
    const weightedSum =
      WEIGHTS.activeRecall    * activeRecall  +
      WEIGHTS.posJaccard      * posJaccard    +
      WEIGHTS.mechanism       * mechanismSim  +
      WEIGHTS.priceEfficiency * priceEfficiency +
      WEIGHTS.safetyProfile   * safetyMatch   +
      WEIGHTS.formFactor      * formFactor;

    // ── Critical active penalty ───────────────────────────────────────────────
    const penalty = this.parser.missingCriticalActivePenalty(tokensA, tokensB, subcategory);

    // ── Concern compatibility multiplier ─────────────────────────────────────
    const concernA      = this.parser.detectPrimaryConcern(tokensA, subcategory);
    const concernB      = this.parser.detectPrimaryConcern(tokensB, subcategory);
    const concernMult   = this.parser.concernCompatibility(concernA, concernB);

    // ── Final composite ───────────────────────────────────────────────────────
    const compositeScore = Math.max(0, Math.min(1, (weightedSum - penalty) * concernMult));

    // ── Diagnostics ───────────────────────────────────────────────────────────
    const confidence  = this.computeConfidence(tokensA.length, tokensB.length);
    const sharedActives = this.computeSharedActives(tokensA, tokensB, subcategory);
    const missingActives = this.computeMissingActives(tokensA, tokensB, subcategory);
    const activeOverlapPct = Math.round(activeRecall * 100);

    return {
      // v2 compat fields
      jaccardScore:    posJaccard,   // closest equivalent
      activesScore:    activeRecall,
      formFactorScore: formFactor,
      compositeScore,
      confidence,
      sharedActives,

      // v3 diagnostics
      activeRecallScore:       activeRecall,
      positionWeightedJaccard: posJaccard,
      mechanismScore:          mechanismSim,
      priceEfficiencyScore:    priceEfficiency,
      safetyMatchScore:        safetyMatch,
      missingActivePenalty:    penalty,
      activeOverlapPct,
      missingActives,
      primaryConcernA:         concernA,
      primaryConcernB:         concernB,
      concernMultiplier:       concernMult,
    };
  }

  /**
   * v2 computeSimilarity — kept for backward compat (rescoreDupe, previewDetection).
   * Internally calls v3 with a default priceRatio of 2 (neutral for non-price scenarios).
   */
  computeSimilarity(a: Product, b: Product, subcategory: string): SimilarityResult {
    return this.computeSimilarityV3(a, b, subcategory, 2.0);
  }

  detectInSubcategory(products: Product[], subcategory: string): DupeCandidate[] {
    const candidates: DupeCandidate[] = [];

    for (let i = 0; i < products.length; i++) {
      for (let j = i + 1; j < products.length; j++) {
        const a = products[i];
        const b = products[j];

        // ── Quality gates ─────────────────────────────────────────────────────
        if (a.brand?.toLowerCase() === b.brand?.toLowerCase()) continue;

        const priceA = Number(a.normalizedPriceInr ?? a.price);
        const priceB = Number(b.normalizedPriceInr ?? b.price);
        if (!priceA || !priceB) continue;

        const [higherPrice, lowerPrice]  = priceA >= priceB ? [priceA, priceB] : [priceB, priceA];
        const savingsPercent             = ((higherPrice - lowerPrice) / higherPrice) * 100;
        const priceRatio                 = higherPrice / lowerPrice;

        if (savingsPercent < MIN_SAVINGS_PCT) continue;
        if (priceRatio > MAX_PRICE_RATIO)     continue;

        // ── Score ─────────────────────────────────────────────────────────────
        const [originalProd, dupeProd] = priceA >= priceB ? [a, b] : [b, a];
        const sim = this.computeSimilarityV3(originalProd, dupeProd, subcategory, priceRatio);

        if (sim.compositeScore < DUPE_THRESHOLD) continue;

        candidates.push({ original: originalProd, dupe: dupeProd, savingsPercent, priceRatio, similarity: sim });
      }
    }

    return candidates.sort((x, y) => {
      const diff = y.similarity.compositeScore - x.similarity.compositeScore;
      return diff !== 0 ? diff : y.savingsPercent - x.savingsPercent;
    });
  }

  // ─── Ranking ─────────────────────────────────────────────────────────────────

  private rankByOriginal(
    candidates: DupeCandidate[],
  ): (DupeCandidate & { rank: number; featured: boolean })[] {
    const grouped = new Map<string, DupeCandidate[]>();

    for (const c of candidates) {
      const key = c.original.id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    }

    const ranked: (DupeCandidate & { rank: number; featured: boolean })[] = [];
    for (const group of grouped.values()) {
      // Already sorted by composite score descending
      group.forEach((c, idx) => {
        ranked.push({ ...c, rank: idx + 1, featured: idx === 0 });
      });
    }
    return ranked;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async loadEligibleProducts(): Promise<Product[]> {
    const all = await this.productsRepo.find({
      select: [
        'id', 'name', 'brand', 'price', 'currency', 'normalizedPriceInr',
        'category', 'subcategory', 'ingredients', 'ingredientsTokens',
        'ingredientBreakdown',
      ],
    });
    return all.filter((p) => this.ensureTokens(p).length >= MIN_TOKENS);
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
    if (score >= 0.82) return 'exact-match';
    if (score >= 0.67) return 'close-dupe';
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

  /**
   * Returns key actives present in original but ABSENT from dupe.
   * This is the human-readable version of the critical active penalty.
   */
  private computeMissingActives(tokensA: string[], tokensB: string[], subcategory: string): string[] {
    const setA    = new Set(tokensA);
    const setB    = new Set(tokensB);
    const actives = this.parser.extractKeyActives(tokensA, subcategory);
    return [...actives].filter((a) => setA.has(a) && !setB.has(a));
  }

  private computeConfidence(lenA: number, lenB: number): number {
    const MIN   = 10;
    const ratio = (Math.min(lenA, MIN) + Math.min(lenB, MIN)) / (2 * MIN);
    return parseFloat(ratio.toFixed(2));
  }

  private candidateToPreview(cand: DupeCandidate, subcategory: string): object {
    const sim = cand.similarity;
    return {
      subcategory,
      label:                    this.dupeLabel(sim.compositeScore),
      compositeScore:           parseFloat(sim.compositeScore.toFixed(3)),
      // v3 breakdown
      activeRecallScore:        parseFloat(sim.activeRecallScore.toFixed(3)),
      positionWeightedJaccard:  parseFloat(sim.positionWeightedJaccard.toFixed(3)),
      mechanismScore:           parseFloat(sim.mechanismScore.toFixed(3)),
      priceEfficiencyScore:     parseFloat(sim.priceEfficiencyScore.toFixed(3)),
      safetyMatchScore:         parseFloat(sim.safetyMatchScore.toFixed(3)),
      missingActivePenalty:     parseFloat(sim.missingActivePenalty.toFixed(3)),
      concernMultiplier:        sim.concernMultiplier,
      // Results
      confidence:               sim.confidence,
      savingsPercent:           Math.round(cand.savingsPercent),
      priceRatio:               parseFloat(cand.priceRatio.toFixed(2)),
      sharedActives:            sim.sharedActives,
      missingActives:           sim.missingActives,
      activeOverlapPct:         sim.activeOverlapPct,
      concerns:                 { original: sim.primaryConcernA, dupe: sim.primaryConcernB },
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
    };
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
        const sim      = cand.similarity;

        const sharedFields = {
          similarityScore:    scoreInt,
          savingsPercent:     Math.round(cand.savingsPercent),
          priceRatio:         parseFloat(cand.priceRatio.toFixed(2)),
          dupeRank:           cand.rank,
          dupeLabel:          this.dupeLabel(sim.compositeScore),
          sharedActives:      sim.sharedActives,
          isFeatured:         cand.featured,
          scoringMethod:      'v3-skin-signal',
          scoreConfidence:    sim.confidence,
          scoreVersion:       SCORE_VERSION,
          scoreCalculatedAt:  now,
          // v3 diagnostic columns
          mechanismScore:     parseFloat(sim.mechanismScore.toFixed(3)),
          activeOverlapPct:   sim.activeOverlapPct,
          missingActives:     sim.missingActives,
          primaryConcern:     sim.primaryConcernA ?? undefined,
        };

        if (existing) {
          await this.dupesRepo.update(existing.id, sharedFields);
          u++;
        } else {
          await this.dupesRepo.save(
            this.dupesRepo.create({
              originalProduct: cand.original,
              dupeProduct:     cand.dupe,
              category,
              isTrending:      false,
              ...sharedFields,
            }),
          );
          c++;
        }
      }
    }

    return { c, u };
  }
}
