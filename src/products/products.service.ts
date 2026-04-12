import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { IngredientParserService } from '../ingredients/ingredient-parser.service';
import { Dupe } from '../dupes/entities/dupe.entity';
import { Review } from '../reviews/entities/review.entity';

// ── Score helpers ────────────────────────────────────────────────────────────

function computeEfficacyScore(breakdown: Product['ingredientBreakdown']): number {
  if (!breakdown) return 50;
  let score = 40;
  score += Math.min((breakdown.actives?.length ?? 0) * 5, 25);
  score += Math.min((breakdown.humectants?.length ?? 0) * 3, 12);
  score += Math.min((breakdown.emollients?.length ?? 0) * 2, 8);
  if (breakdown.fungalAcneSafe) score += 5;
  if (breakdown.pregnancySafe) score += 3;
  score -= Math.min((breakdown.comedogenicCount ?? 0) * 2, 15);
  return Math.max(20, Math.min(100, Math.round(score)));
}

function computeIrritancyRisk(breakdown: Product['ingredientBreakdown']): 'low' | 'medium' | 'high' {
  if (!breakdown) return 'medium';
  const { maxComedogenicity, comedogenicCount } = breakdown;
  if ((maxComedogenicity ?? 0) >= 4 || (comedogenicCount ?? 0) >= 3) return 'high';
  if ((maxComedogenicity ?? 0) >= 2 || (comedogenicCount ?? 0) >= 1) return 'medium';
  return 'low';
}

function computeValueScore(product: Product, dupes: Dupe[]): number {
  if (!dupes.length) return 75;
  const bestDupe = dupes.reduce((best, d) => d.similarityScore > best.similarityScore ? d : best, dupes[0]);
  if (bestDupe.similarityScore >= 80 && (bestDupe.savingsPercent ?? 0) >= 40) return 45;
  if (bestDupe.similarityScore >= 70 && (bestDupe.savingsPercent ?? 0) >= 25) return 58;
  return 72;
}

function computeCleanScore(breakdown: Product['ingredientBreakdown'], ingredientsRaw: string | null): number {
  let score = 100;
  if (breakdown) {
    score -= Math.min((breakdown.preservatives?.length ?? 0) * 5, 20);
    score -= Math.min((breakdown.comedogenicCount ?? 0) * 3, 15);
    if (breakdown.fungalAcneSafe) score += 5;
    if (breakdown.pregnancySafe) score += 5;
  }
  if (ingredientsRaw) {
    const lower = ingredientsRaw.toLowerCase();
    if (lower.includes('fragrance') || lower.includes('parfum')) score -= 10;
    if (lower.includes('alcohol denat') || lower.includes('sd alcohol')) score -= 8;
    if (lower.includes('formaldehyde')) score -= 20;
    if (lower.includes('parabens') || lower.includes('paraben')) score -= 10;
    if (lower.includes('mineral oil')) score -= 5;
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

  findAll(limit = 20, offset = 0) {
    return this.productsRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async search(q: string, limit = 8): Promise<Product[]> {
    if (!q || q.trim().length < 2) return [];
    return this.productsRepo
      .createQueryBuilder('product')
      .where('product.name LIKE :q OR product.brand LIKE :q', { q: `%${q.trim()}%` })
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
    const parsedIngredients = product.ingredients
      ? await this.ingredientParser.parseIngredientList(product.ingredients)
      : [];

    // Fetch dupes for this product as the original
    const dupes = await this.dupesRepo.find({
      where: { originalProduct: { id } },
      relations: ['dupeProduct'],
      order: { similarityScore: 'DESC' },
      take: 10,
    });

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
      value: computeValueScore(product, dupes),
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
