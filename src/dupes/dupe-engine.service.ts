import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dupe } from './entities/dupe.entity';
import { Product } from '../products/entities/product.entity';
import { IngredientParserService } from '../scraping/ingredient-parser.service';

const SCORE_VERSION = '1.0';

/**
 * Weights for the composite similarity score.
 *
 *  60%  — Jaccard similarity across full ingredient lists
 *  25%  — Key-active overlap (subcategory-specific power ingredients)
 *  15%  — Form-factor / texture match inferred from subcategory
 *
 * A pair is a dupe candidate when compositeScore >= DUPE_THRESHOLD.
 * Additionally, the cheaper product must be at least MIN_SAVINGS_PCT cheaper.
 */
const WEIGHTS = { jaccard: 0.6, actives: 0.25, formFactor: 0.15 } as const;
const DUPE_THRESHOLD = 0.35;     // minimum composite score
const MIN_SAVINGS_PCT = 5;       // at least 5% cheaper to qualify as a dupe
const BATCH_SAVE_SIZE = 50;      // upsert in batches

interface SimilarityResult {
  jaccardScore: number;
  activesScore: number;
  formFactorScore: number;
  compositeScore: number;
  confidence: number;           // 0–1: how complete/reliable the data is
}

interface DupeCandidate {
  original: Product;  // the pricier one
  dupe: Product;      // the cheaper one
  savingsPercent: number;
  similarity: SimilarityResult;
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

  /**
   * Preview dupe detection without saving anything to the database.
   * Optionally filter by subcategory. Returns ranked dupe candidates.
   */
  async previewDetection(subcategoryFilter?: string): Promise<object[]> {
    const allProducts = await this.productsRepo.find({
      select: [
        'id', 'name', 'brand', 'price', 'currency', 'normalizedPriceInr',
        'category', 'subcategory', 'ingredients', 'ingredientsTokens',
      ],
    });

    const eligible = allProducts.filter(
      (p) => p.ingredients || p.ingredientsTokens?.length,
    );

    const bySubcategory = this.groupBySubcategory(eligible);
    const results: object[] = [];

    for (const [subcategory, products] of bySubcategory.entries()) {
      if (subcategoryFilter && subcategory !== subcategoryFilter.toLowerCase()) continue;

      const candidates = this.detectInSubcategory(products, subcategory);
      for (const cand of candidates) {
        results.push({
          subcategory,
          compositeScore: parseFloat(cand.similarity.compositeScore.toFixed(3)),
          jaccardScore: parseFloat(cand.similarity.jaccardScore.toFixed(3)),
          activesScore: parseFloat(cand.similarity.activesScore.toFixed(3)),
          confidence: cand.similarity.confidence,
          savingsPercent: Math.round(cand.savingsPercent),
          original: {
            id: cand.original.id,
            name: cand.original.name,
            brand: cand.original.brand,
            price: Number(cand.original.price),
            currency: cand.original.currency,
          },
          dupe: {
            id: cand.dupe.id,
            name: cand.dupe.name,
            brand: cand.dupe.brand,
            price: Number(cand.dupe.price),
            currency: cand.dupe.currency,
          },
          sharedIngredients: this.sharedIngredients(cand.original, cand.dupe),
        });
      }
    }

    return results.sort(
      (a: any, b: any) => b.compositeScore - a.compositeScore,
    );
  }

  /**
   * Parse a raw ingredient string and return tokens + key actives.
   * Pure utility — no DB access.
   */
  parseIngredients(raw: string, subcategory: string): object {
    const tokens = this.parser.parse(raw);
    const actives = this.parser.extractKeyActives(tokens, subcategory);
    return {
      totalTokens: tokens.length,
      tokens,
      keyActives: [...actives],
    };
  }

  /**
   * Run the full dupe detection pipeline over all products in the database.
   * Groups products by subcategory, computes pairwise similarity, and
   * upserts qualifying dupe pairs into the dupes table.
   *
   * Returns a summary of created / updated dupe records.
   */
  async runFullDetection(): Promise<{ created: number; updated: number }> {
    this.logger.log('Starting full dupe detection run…');

    const allProducts = await this.productsRepo.find({
      select: [
        'id', 'name', 'brand', 'price', 'currency', 'normalizedPriceInr',
        'category', 'subcategory', 'ingredients', 'ingredientsTokens',
      ],
    });

    // Group by subcategory (ignore products with no ingredient data)
    const bySubcategory = this.groupBySubcategory(
      allProducts.filter((p) => p.ingredients || p.ingredientsTokens?.length),
    );

    let created = 0;
    let updated = 0;

    for (const [subcategory, products] of bySubcategory.entries()) {
      this.logger.debug(`Detecting dupes in subcategory: ${subcategory} (${products.length} products)`);
      const candidates = this.detectInSubcategory(products, subcategory);
      const { c, u } = await this.upsertCandidates(candidates, subcategory);
      created += c;
      updated += u;
    }

    this.logger.log(`Dupe detection complete. Created: ${created}, Updated: ${updated}`);
    return { created, updated };
  }

  /**
   * Re-score a single existing dupe record (e.g. after ingredient data is enriched).
   */
  async rescoreDupe(dupeId: string): Promise<void> {
    const dupe = await this.dupesRepo.findOne({
      where: { id: dupeId },
      relations: ['originalProduct', 'dupeProduct'],
    });
    if (!dupe) return;

    const subcategory =
      dupe.originalProduct.subcategory ?? dupe.dupeProduct.subcategory ?? '';
    const sim = this.computeSimilarity(
      dupe.originalProduct,
      dupe.dupeProduct,
      subcategory,
    );

    await this.dupesRepo.update(dupeId, {
      similarityScore: Math.round(sim.compositeScore * 100),
      scoringMethod: 'jaccard+actives+form',
      scoreConfidence: sim.confidence,
      scoreVersion: SCORE_VERSION,
      scoreCalculatedAt: new Date(),
    });
  }

  // ─── Core Algorithm ───────────────────────────────────────────────────────

  /**
   * Compute the composite similarity between two products.
   *
   * Score breakdown:
   *  1. Jaccard similarity on full ingredient token sets.
   *  2. Active-ingredient overlap for the given subcategory.
   *  3. Form-factor match: 1.0 if same subcategory, 0.5 if same parent category.
   *
   * Confidence reflects data quality:
   *  – both products have ≥10 ingredients → high confidence
   *  – one has fewer → scaled down
   */
  computeSimilarity(a: Product, b: Product, subcategory: string): SimilarityResult {
    const tokensA = this.ensureTokens(a);
    const tokensB = this.ensureTokens(b);

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);

    const jaccardScore = this.parser.jaccard(setA, setB);
    const activesScore = this.parser.activeOverlap(tokensA, tokensB, subcategory);
    const formFactorScore = this.formFactorScore(a, b);

    const compositeScore =
      WEIGHTS.jaccard * jaccardScore +
      WEIGHTS.actives * activesScore +
      WEIGHTS.formFactor * formFactorScore;

    const confidence = this.computeConfidence(tokensA.length, tokensB.length);

    return { jaccardScore, activesScore, formFactorScore, compositeScore, confidence };
  }

  /**
   * Run pairwise dupe detection within a subcategory's product list.
   * Uses an O(n²) comparison — suitable for groups up to ~500 products.
   * For larger groups a blocking/LSH approach should be added.
   */
  detectInSubcategory(products: Product[], subcategory: string): DupeCandidate[] {
    const candidates: DupeCandidate[] = [];

    for (let i = 0; i < products.length; i++) {
      for (let j = i + 1; j < products.length; j++) {
        const a = products[i];
        const b = products[j];

        // Require a meaningful price difference
        const priceDiff = this.priceDiffPercent(a, b);
        if (Math.abs(priceDiff) < MIN_SAVINGS_PCT) continue;

        const sim = this.computeSimilarity(a, b, subcategory);
        if (sim.compositeScore < DUPE_THRESHOLD) continue;

        // Orient: original = pricier, dupe = cheaper
        const [original, dupe, savingsPercent] =
          priceDiff > 0
            ? [a, b, priceDiff]          // a is pricier
            : [b, a, Math.abs(priceDiff)];

        candidates.push({ original, dupe, savingsPercent, similarity: sim });
      }
    }

    // Sort by composite score descending, then savings descending
    return candidates.sort((x, y) => {
      const scoreDiff = y.similarity.compositeScore - x.similarity.compositeScore;
      return scoreDiff !== 0 ? scoreDiff : y.savingsPercent - x.savingsPercent;
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

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

  /**
   * Percent by which product A is more expensive than B (positive = A pricier).
   * Uses normalizedPriceInr when available so cross-currency pairs work.
   */
  private priceDiffPercent(a: Product, b: Product): number {
    const priceA = Number(a.normalizedPriceInr ?? a.price);
    const priceB = Number(b.normalizedPriceInr ?? b.price);
    if (!priceB) return 0;
    return ((priceA - priceB) / priceB) * 100;
  }

  private formFactorScore(a: Product, b: Product): number {
    if (!a.subcategory || !b.subcategory) return 0.5;
    if (a.subcategory.toLowerCase() === b.subcategory.toLowerCase()) return 1.0;
    if (a.category?.toLowerCase() === b.category?.toLowerCase()) return 0.5;
    return 0;
  }

  private sharedIngredients(a: Product, b: Product): string[] {
    const setA = new Set(this.ensureTokens(a));
    const setB = new Set(this.ensureTokens(b));
    return [...setA].filter((t) => setB.has(t));
  }

  private computeConfidence(lenA: number, lenB: number): number {
    // Full confidence when both products have ≥10 ingredients
    const MIN = 10;
    const ratioA = Math.min(lenA / MIN, 1);
    const ratioB = Math.min(lenB / MIN, 1);
    return parseFloat(((ratioA + ratioB) / 2).toFixed(2));
  }

  /**
   * Upsert dupe candidates into the DB (insert or update similarity score).
   * Uses ON DUPLICATE KEY behaviour via a query — the unique constraint is
   * (original_product_id, dupe_product_id).
   */
  private async upsertCandidates(
    candidates: DupeCandidate[],
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
            dupeProduct: { id: cand.dupe.id },
          },
        });

        const scoreInt = Math.round(cand.similarity.compositeScore * 100);
        const now = new Date();

        if (existing) {
          await this.dupesRepo.update(existing.id, {
            similarityScore: scoreInt,
            savingsPercent: Math.round(cand.savingsPercent),
            scoringMethod: 'jaccard+actives+form',
            scoreConfidence: cand.similarity.confidence,
            scoreVersion: SCORE_VERSION,
            scoreCalculatedAt: now,
          });
          u++;
        } else {
          const category = cand.original.category ?? cand.dupe.category ?? subcategory;
          const newDupe = this.dupesRepo.create({
            originalProduct: cand.original,
            dupeProduct: cand.dupe,
            similarityScore: scoreInt,
            savingsPercent: Math.round(cand.savingsPercent),
            category,
            scoringMethod: 'jaccard+actives+form',
            scoreConfidence: cand.similarity.confidence,
            scoreVersion: SCORE_VERSION,
            scoreCalculatedAt: now,
            isFeatured: false,
            isTrending: false,
          });
          await this.dupesRepo.save(newDupe);
          c++;
        }
      }
    }

    return { c, u };
  }
}
