import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { IngredientParserService } from '../ingredients/ingredient-parser.service';
import { IngredientsService } from '../ingredients/ingredients.service';
import { Dupe } from '../dupes/entities/dupe.entity';
import { Review } from '../reviews/entities/review.entity';

// ── Score helpers ────────────────────────────────────────────────────────────

function computeEfficacyScore(breakdown: Product['ingredientBreakdown']): number {
  if (!breakdown) return 50;

  const recognized = breakdown.recognizedCount ?? 0;
  const total = breakdown.tokenCount ?? 1;
  const recognitionRatio = recognized / total;

  let score = 25;

  // Actives contribution (0–30): more actives = higher efficacy
  const actives = breakdown.actives?.length ?? 0;
  score += Math.min(actives * 7, 30);

  // Actives in top 5 positions = higher concentration = bigger boost (0–15)
  score += (breakdown.activesInTopFive ?? 0) * 5;

  // Supporting ingredients (0–12)
  score += Math.min((breakdown.humectants?.length ?? 0) * 3, 9);
  score += Math.min((breakdown.emollients?.length ?? 0) * 2, 6);

  // Recognition ratio bonus — well-known ingredients are confidence signal (0–10)
  score += Math.round(recognitionRatio * 10);

  // Safety bonuses (0–5)
  if (breakdown.fungalAcneSafe) score += 3;
  if (breakdown.pregnancySafe) score += 2;

  // Penalties
  score -= Math.min((breakdown.comedogenicCount ?? 0) * 3, 15);
  if (breakdown.hasFragrance) score -= 3;

  return Math.max(10, Math.min(100, Math.round(score)));
}

function computeIrritancyRisk(breakdown: Product['ingredientBreakdown']): 'low' | 'medium' | 'high' {
  if (!breakdown) return 'medium';

  let riskScore = 0;
  riskScore += Math.min((breakdown.maxComedogenicity ?? 0) * 2, 10);
  riskScore += Math.min((breakdown.comedogenicCount ?? 0) * 1.5, 6);
  if (breakdown.hasFragrance) riskScore += 3;
  if (breakdown.hasAlcohol) riskScore += 3;
  if (!breakdown.fungalAcneSafe) riskScore += 2;

  if (riskScore >= 10) return 'high';
  if (riskScore >= 4) return 'medium';
  return 'low';
}

function computeValueScore(product: Product, dupes: Dupe[], dupesAsDupe: Dupe[] = []): number {
  // Direction 1: this product IS the dupe (cheap alternative to expensive products) → high value
  if (dupesAsDupe.length > 0) {
    const bestSavings = Math.max(...dupesAsDupe.map((d) => d.savingsPercent ?? 0));
    const bestSimilarity = Math.max(...dupesAsDupe.map((d) => d.similarityScore));
    let score = 70;
    if (bestSimilarity >= 85 && bestSavings >= 50) score = 95;
    else if (bestSimilarity >= 80 && bestSavings >= 40) score = 90;
    else if (bestSimilarity >= 75 && bestSavings >= 30) score = 85;
    else if (bestSimilarity >= 70 && bestSavings >= 20) score = 80;
    // If also has cheaper dupes of its own, temper slightly
    if (dupes.length > 0) score -= 5;
    return Math.max(20, Math.min(95, Math.round(score)));
  }

  // Direction 2: this product is the original (expensive) with cheaper dupes → lower value
  if (!dupes.length) return 70;

  const avgSavings = dupes.reduce((sum, d) => sum + (d.savingsPercent ?? 0), 0) / dupes.length;
  const bestSimilarity = Math.max(...dupes.map((d) => d.similarityScore));
  const bestSavings = Math.max(...dupes.map((d) => d.savingsPercent ?? 0));

  let score = 80;
  if (bestSimilarity >= 85 && bestSavings >= 50) score -= 35;
  else if (bestSimilarity >= 80 && bestSavings >= 40) score -= 28;
  else if (bestSimilarity >= 75 && bestSavings >= 30) score -= 22;
  else if (bestSimilarity >= 70 && bestSavings >= 20) score -= 15;
  else if (bestSimilarity >= 60 && avgSavings >= 10) score -= 8;

  if (dupes.length <= 2) score += 5;

  return Math.max(20, Math.min(95, Math.round(score)));
}

function computeCleanScore(breakdown: Product['ingredientBreakdown'], ingredientsRaw: string | null): number {
  if (!breakdown && !ingredientsRaw) return 50;

  let score = 85;

  if (breakdown) {
    // Preservative penalty (0–15)
    score -= Math.min((breakdown.preservatives?.length ?? 0) * 4, 15);
    // Comedogenic penalty (0–12)
    score -= Math.min((breakdown.comedogenicCount ?? 0) * 3, 12);
    // Max comedogenicity penalty
    if ((breakdown.maxComedogenicity ?? 0) >= 4) score -= 8;
    else if ((breakdown.maxComedogenicity ?? 0) >= 3) score -= 4;
    // Safety bonuses
    if (breakdown.fungalAcneSafe) score += 4;
    if (breakdown.pregnancySafe) score += 4;
    // Pre-computed flags from breakdown
    if (breakdown.hasFragrance) score -= 10;
    if (breakdown.hasAlcohol) score -= 8;
    if (breakdown.hasParaben) score -= 8;
  }

  if (ingredientsRaw) {
    const lower = ingredientsRaw.toLowerCase();
    if (lower.includes('formaldehyde')) score -= 20;
    if (lower.includes('mineral oil')) score -= 5;
    if (lower.includes('peg-')) score -= 3;
    if (lower.includes('sls') || lower.includes('sodium lauryl sulfate')) score -= 6;
    if (lower.includes('sodium laureth sulfate') || lower.includes('sles')) score -= 4;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function groupIngredients(parsedIngredients: any[], breakdown: Product['ingredientBreakdown']) {
  const activesSet = new Set((breakdown?.actives ?? []).map((a: string) => a.toLowerCase()));
  const humectantsSet = new Set((breakdown?.humectants ?? []).map((a: string) => a.toLowerCase()));
  const emollientsSet = new Set((breakdown?.emollients ?? []).map((a: string) => a.toLowerCase()));
  const preservativesSet = new Set((breakdown?.preservatives ?? []).map((a: string) => a.toLowerCase()));

  const groups: Record<string, any[]> = {
    starActives: [],
    hydrators: [],
    barrierBuilders: [],
    botanicals: [],
    watchList: [],
    functional: [],
    other: [],
  };

  for (const ing of parsedIngredients) {
    const nameLower = (ing.name ?? '').toLowerCase();
    const cat = (ing.category ?? '').toLowerCase();

    if (activesSet.has(nameLower) || cat === 'active' || cat === 'exfoliant' || cat === 'retinoid') {
      groups.starActives.push(ing);
    } else if (humectantsSet.has(nameLower) || cat === 'humectant') {
      groups.hydrators.push(ing);
    } else if (emollientsSet.has(nameLower) || cat === 'emollient' || cat === 'occlusive' || cat === 'ceramide') {
      groups.barrierBuilders.push(ing);
    } else if (cat === 'botanical' || cat === 'plant extract' || cat === 'herbal') {
      groups.botanicals.push(ing);
    } else if (
      (ing.comedogenicity ?? 0) >= 3 ||
      preservativesSet.has(nameLower) ||
      cat === 'preservative' ||
      cat === 'fragrance'
    ) {
      groups.watchList.push(ing);
    } else if (cat === 'emulsifier' || cat === 'thickener' || cat === 'solvent' || cat === 'chelating') {
      groups.functional.push(ing);
    } else {
      groups.other.push(ing);
    }
  }

  return groups;
}

function deriveEthicsFlags(ingredientsRaw: string | null) {
  if (!ingredientsRaw) return { fragranceFree: null, alcoholFree: null, parabenFree: null, siliconeFree: null };
  const lower = ingredientsRaw.toLowerCase();
  return {
    fragranceFree: !lower.includes('fragrance') && !lower.includes('parfum'),
    alcoholFree: !lower.includes('alcohol denat') && !lower.includes('sd alcohol') && !lower.includes('ethanol'),
    parabenFree: !lower.includes('paraben'),
    siliconeFree: !lower.includes('dimethicone') && !lower.includes('cyclomethicone') && !lower.includes('silicone'),
  };
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productsRepo: Repository<Product>,
    @InjectRepository(Dupe)
    private dupesRepo: Repository<Dupe>,
    @InjectRepository(Review)
    private reviewsRepo: Repository<Review>,
    private ingredientParser: IngredientParserService,
    private ingredientsService: IngredientsService,
  ) {}

  async getTopBrands(limit = 20): Promise<string[]> {
    const rows = await this.productsRepo
      .createQueryBuilder('product')
      .select('product.brand', 'brand')
      .addSelect('COUNT(*)', 'cnt')
      .where('product.brand IS NOT NULL AND product.brand != :empty', { empty: '' })
      .groupBy('product.brand')
      .orderBy('cnt', 'DESC')
      .limit(limit)
      .getRawMany();
    return rows.map((r) => r.brand as string);
  }

  findAll(limit = 20, offset = 0, category?: string, sort?: string, subcategory?: string) {
    const qb = this.productsRepo.createQueryBuilder('product');

    if (category) qb.andWhere('product.category = :category', { category });
    if (subcategory) qb.andWhere('product.subcategory = :subcategory', { subcategory });

    switch (sort) {
      case 'trending':
        qb.orderBy('product.createdAt', 'DESC'); break;
      case 'price_asc':
        qb.orderBy('product.price', 'ASC'); break;
      case 'price_desc':
        qb.orderBy('product.price', 'DESC'); break;
      default:
        qb.orderBy('product.createdAt', 'DESC');
    }

    return qb.take(limit).skip(offset).getMany();
  }

  async search(q: string, limit = 8, category?: string, subcategory?: string): Promise<Product[]> {
    if (!q || q.trim().length < 2) return [];
    const qb = this.productsRepo
      .createQueryBuilder('product')
      .where('product.name LIKE :q OR product.brand LIKE :q', { q: `%${q.trim()}%` });

    if (category) qb.andWhere('product.category = :category', { category });
    if (subcategory) qb.andWhere('product.subcategory = :subcategory', { subcategory });

    return qb
      .orderBy('product.brand', 'ASC')
      .addOrderBy('product.name', 'ASC')
      .limit(limit)
      .getMany();
  }

  async findOne(id: string) {
    const product = await this.productsRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async getWithParsedIngredients(id: string) {
    const product = await this.findOne(id);
    const parsedIngredients = product.ingredients
      ? await this.ingredientParser.parseIngredientList(product.ingredients)
      : [];
    return { ...product, parsedIngredients };
  }

  async getProductDetail(id: string) {
    const product = await this.findOne(id);
    const rawTokens = product.ingredients
      ? await this.ingredientParser.parseIngredientList(product.ingredients)
      : [];

    // Batch-enrich tokens with ingredient DB metadata (category, effects, etc.)
    const canonicalNames = rawTokens
      .map((t) => t.canonicalName)
      .filter((n): n is string => !!n);
    const enrichedMap = new Map(
      (await this.ingredientsService.enrichTokensWithIngredientData(canonicalNames))
        .map((e) => [e.canonicalName, e]),
    );

    // Normalise tokens: rename cleanName → name so the frontend interface matches
    const parsedIngredients = rawTokens.map((token) => {
      const enriched = token.canonicalName ? enrichedMap.get(token.canonicalName) : undefined;
      return {
        name: token.cleanName,
        canonicalName: token.canonicalName ?? undefined,
        category: enriched?.category ?? undefined,
        effects: enriched?.effects ?? [],
        comedogenicity: enriched?.comedogenicity ?? undefined,
        fungalAcneSafe: !enriched?.warnings?.includes('Not safe for fungal acne'),
        pregnancySafe: !enriched?.warnings?.includes('Not recommended during pregnancy'),
        skinTypeScores: enriched?.skinTypeScores ?? undefined,
        concentrationTier: token.concentrationTier,
        isUnknown: token.isUnknown,
      };
    });

    // Fetch dupes in both directions:
    // 1. This product is the original (expensive) → dupes are cheaper alternatives
    // 2. This product is the dupe (cheap) → originals are pricier equivalents
    const [dupesAsOriginal, dupesAsDupe] = await Promise.all([
      this.dupesRepo.find({
        where: { originalProduct: { id } },
        relations: ['dupeProduct'],
        order: { similarityScore: 'DESC' },
        take: 10,
      }),
      this.dupesRepo.find({
        where: { dupeProduct: { id } },
        relations: ['originalProduct'],
        order: { similarityScore: 'DESC' },
        take: 10,
      }),
    ]);
    const dupes = dupesAsOriginal;

    // Aggregate reviews via dupe relationships
    const dupeIds = dupes.map((d) => d.id);
    let reviews: Review[] = [];
    if (dupeIds.length > 0) {
      reviews = await this.reviewsRepo
        .createQueryBuilder('review')
        .leftJoinAndSelect('review.user', 'user')
        .leftJoinAndSelect('review.dupe', 'dupe')
        .where('dupe.id IN (:...dupeIds)', { dupeIds })
        .orderBy('review.createdAt', 'DESC')
        .take(50)
        .getMany();
    }

    // Compute SkinEvora scores
    const breakdown = product.ingredientBreakdown;
    const skinevoraScores = {
      efficacy: computeEfficacyScore(breakdown),
      irritancy: computeIrritancyRisk(breakdown),
      value: computeValueScore(product, dupes, dupesAsDupe),
      clean: computeCleanScore(breakdown, product.ingredients),
    };

    // Ethics flags derived from ingredient list
    const ethics = deriveEthicsFlags(product.ingredients);

    // Reviews summary
    const totalReviews = reviews.length;
    const avgRating = totalReviews > 0
      ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews) * 10) / 10
      : null;
    const ratingBreakdown = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: reviews.filter((r) => r.rating === star).length,
    }));

    // Ingredient groupings for Zone 4
    const ingredientGroups = groupIngredients(parsedIngredients, breakdown);

    return {
      id: product.id,
      name: product.name,
      brand: product.brand,
      price: Number(product.price),
      normalizedPriceInr: Number(product.normalizedPriceInr ?? product.price),
      currency: product.currency,
      imageUrl: product.imageUrl,
      category: product.category,
      subcategory: product.subcategory,
      description: product.description,
      size: product.size,
      quantity: product.quantity,
      sourceUrl: product.sourceUrl,
      platform: product.platform,
      store: product.store,
      ingredients: product.ingredients,
      ingredientsTokens: product.ingredientsTokens,
      ingredientBreakdown: breakdown,
      skinTypeSuitability: product.skinTypeSuitability,
      skinTypeRecommendedFor: product.skinTypeRecommendedFor ?? [],
      parsedIngredients,
      ingredientGroups,
      skinevoraScores,
      ethics,
      dupes: dupes.map((d) => ({
        id: d.id,
        similarityScore: d.similarityScore,
        savingsPercent: d.savingsPercent,
        dupeLabel: d.dupeLabel ?? null,
        sharedActives: d.sharedActives ?? [],
        missingActives: d.missingActives ?? [],
        dupeProduct: {
          id: d.dupeProduct.id,
          name: d.dupeProduct.name,
          brand: d.dupeProduct.brand,
          price: Number(d.dupeProduct.price),
          normalizedPriceInr: Number(d.dupeProduct.normalizedPriceInr ?? d.dupeProduct.price),
          currency: d.dupeProduct.currency,
          imageUrl: d.dupeProduct.imageUrl,
          sourceUrl: d.dupeProduct.sourceUrl,
          size: d.dupeProduct.size,
          platform: d.dupeProduct.platform,
          ingredientBreakdown: d.dupeProduct.ingredientBreakdown,
        },
      })),
      dupeOf: dupesAsDupe.map((d) => ({
        id: d.id,
        similarityScore: d.similarityScore,
        savingsPercent: d.savingsPercent,
        dupeLabel: d.dupeLabel ?? null,
        sharedActives: d.sharedActives ?? [],
        originalProduct: {
          id: d.originalProduct.id,
          name: d.originalProduct.name,
          brand: d.originalProduct.brand,
          price: Number(d.originalProduct.price),
          normalizedPriceInr: Number(d.originalProduct.normalizedPriceInr ?? d.originalProduct.price),
          currency: d.originalProduct.currency,
          imageUrl: d.originalProduct.imageUrl,
          sourceUrl: d.originalProduct.sourceUrl,
          size: d.originalProduct.size,
          platform: d.originalProduct.platform,
        },
      })),
      reviews: {
        total: totalReviews,
        avgRating,
        ratingBreakdown,
        items: reviews.slice(0, 20).map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
          userName: r.user ? r.user.email?.split('@')[0] ?? 'Anonymous' : 'Anonymous',
        })),
      },
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  create(dto: CreateProductDto) {
    const product = this.productsRepo.create(dto);
    return this.productsRepo.save(product);
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    await this.productsRepo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.productsRepo.delete(id);
  }

  async flag(id: string, reason: string, note?: string) {
    await this.findOne(id);
    await this.productsRepo.update(id, {
      flaggedReason: reason,
      flagNote: note ?? null,
      flaggedAt: new Date(),
    });
  }
}
