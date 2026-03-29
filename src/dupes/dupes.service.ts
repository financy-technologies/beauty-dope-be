import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dupe } from './entities/dupe.entity';
import { Product } from '../products/entities/product.entity';
import { CreateDupeDto } from './dto/create-dupe.dto';
import { QueryDupesDto } from './dto/query-dupes.dto';
import { FilterDupesByIngredientsDto, CompareIngredientsDto, IngredientComparisonResponseDto } from './dto/filter-dupes-by-ingredients.dto';
import { IngredientsService } from '../ingredients/ingredients.service';
import { IngredientParserService } from '../ingredients/ingredient-parser.service';

const PRODUCT_RELATIONS = ['originalProduct', 'dupeProduct'];

function mapDupe(d: Dupe) {
  return {
    id: d.id,
    similarityScore: d.similarityScore,
    savingsPercent: d.savingsPercent,
    priceRatio: d.priceRatio ? Number(d.priceRatio) : null,
    dupeRank: d.dupeRank ?? null,
    dupeLabel: d.dupeLabel ?? null,
    sharedActives: d.sharedActives ?? [],
    scoringMethod: d.scoringMethod,
    scoreConfidence: d.scoreConfidence,
    scoreVersion: d.scoreVersion,
    scoreCalculatedAt: d.scoreCalculatedAt,
    category: d.category,
    totalVotes: d.totalVotes,
    avgRating: Number(d.avgRating),
    isFeatured: d.isFeatured,
    isTrending: d.isTrending,
    createdAt: d.createdAt,
    original: {
      id: d.originalProduct.id,
      name: d.originalProduct.name,
      brand: d.originalProduct.brand,
      price: Number(d.originalProduct.price),
      normalizedPriceInr: Number(d.originalProduct.normalizedPriceInr ?? d.originalProduct.price),
      currency: d.originalProduct.currency,
      platform: d.originalProduct.platform,
      store: d.originalProduct.store,
      subcategory: d.originalProduct.subcategory,
      image: d.originalProduct.imageUrl || '',
      sourceUrl: d.originalProduct.sourceUrl || null,
    },
    dupe: {
      id: d.dupeProduct.id,
      name: d.dupeProduct.name,
      brand: d.dupeProduct.brand,
      price: Number(d.dupeProduct.price),
      normalizedPriceInr: Number(d.dupeProduct.normalizedPriceInr ?? d.dupeProduct.price),
      currency: d.dupeProduct.currency,
      platform: d.dupeProduct.platform,
      store: d.dupeProduct.store,
      subcategory: d.dupeProduct.subcategory,
      image: d.dupeProduct.imageUrl || '',
      sourceUrl: d.dupeProduct.sourceUrl || null,
    },
  };
}

@Injectable()
export class DupesService {
  constructor(
    @InjectRepository(Dupe)
    private dupesRepo: Repository<Dupe>,
    @InjectRepository(Product)
    private productsRepo: Repository<Product>,
    private ingredientsService: IngredientsService,
    private ingredientParser: IngredientParserService,
  ) {}

  async findAll(query: QueryDupesDto) {
    const {
      category,
      subcategory,
      platform,
      store,
      minPrice,
      maxPrice,
      limit = 10,
      offset = 0,
      sort = 'created_at',
    } = query;

    const qb = this.dupesRepo
      .createQueryBuilder('dupe')
      .leftJoinAndSelect('dupe.originalProduct', 'original')
      .leftJoinAndSelect('dupe.dupeProduct', 'dupeProduct');

    qb.where('1=1');

    if (category) {
      qb.andWhere('dupe.category = :category', { category });
    }

    if (subcategory) {
      qb.andWhere(
        '(original.subcategory = :subcategory OR dupeProduct.subcategory = :subcategory)',
        { subcategory },
      );
    }

    if (platform) {
      qb.andWhere('(original.platform = :platform OR dupeProduct.platform = :platform)', {
        platform,
      });
    }

    if (store) {
      qb.andWhere('(original.store = :store OR dupeProduct.store = :store)', {
        store,
      });
    }

    if (minPrice !== undefined) {
      qb.andWhere('dupeProduct.price >= :minPrice', { minPrice });
    }

    if (maxPrice !== undefined) {
      qb.andWhere('dupeProduct.price <= :maxPrice', { maxPrice });
    }

    switch (sort) {
      case 'similarity':
        qb.orderBy('dupe.similarityScore', 'DESC');
        break;
      case 'savings':
        qb.orderBy('dupe.savingsPercent', 'DESC');
        break;
      case 'rating':
        qb.orderBy('dupe.avgRating', 'DESC');
        break;
      case 'trending':
        qb.orderBy('dupe.totalVotes', 'DESC');
        break;
      case 'confidence':
        qb.orderBy('dupe.scoreConfidence', 'DESC');
        break;
      default:
        qb.orderBy('dupe.createdAt', 'DESC');
    }

    const [dupes, total] = await qb.skip(offset).take(limit).getManyAndCount();

    return {
      data: dupes.map(mapDupe),
      total,
      limit,
      offset,
    };
  }

  async findFeatured(limit = 4) {
    const dupes = await this.dupesRepo.find({
      where: { isFeatured: true },
      relations: PRODUCT_RELATIONS,
      order: { similarityScore: 'DESC' },
      take: limit,
    });
    return dupes.map(mapDupe);
  }

  async findTrending(limit = 5) {
    const dupes = await this.dupesRepo.find({
      where: { isTrending: true },
      relations: ['originalProduct', 'dupeProduct'],
      order: { totalVotes: 'DESC' },
      take: limit,
    });

    return dupes.map((d, index) => ({
      id: d.id,
      rank: index + 1,
      original: { brand: d.originalProduct.brand, name: d.originalProduct.name },
      dupe: { brand: d.dupeProduct.brand, name: d.dupeProduct.name },
      savings: `$${Math.round((Number(d.originalProduct.price) * d.savingsPercent) / 100)}`,
      votes: d.totalVotes,
      rating: Number(d.avgRating),
    }));
  }

  async findOne(id: string) {
    const dupe = await this.dupesRepo.findOne({
      where: { id },
      relations: PRODUCT_RELATIONS,
    });
    if (!dupe) throw new NotFoundException(`Dupe ${id} not found`);

    const base = mapDupe(dupe);

    // Parse both products' ingredient lists — graceful, never throws for unknowns
    const [parsedOriginal, parsedDupe] = await Promise.all([
      dupe.originalProduct.ingredients
        ? this.ingredientParser.parseIngredientList(dupe.originalProduct.ingredients)
        : Promise.resolve([]),
      dupe.dupeProduct.ingredients
        ? this.ingredientParser.parseIngredientList(dupe.dupeProduct.ingredients)
        : Promise.resolve([]),
    ]);

    return {
      ...base,
      original: {
        ...base.original,
        rawIngredients: dupe.originalProduct.ingredients ?? null,
        parsedIngredients: parsedOriginal,
      },
      dupe: {
        ...base.dupe,
        rawIngredients: dupe.dupeProduct.ingredients ?? null,
        parsedIngredients: parsedDupe,
      },
    };
  }

  async create(dto: CreateDupeDto) {
    const original = await this.productsRepo.findOne({ where: { id: dto.originalProductId } });
    if (!original) throw new NotFoundException(`Product ${dto.originalProductId} not found`);

    const dupeProduct = await this.productsRepo.findOne({ where: { id: dto.dupeProductId } });
    if (!dupeProduct) throw new NotFoundException(`Product ${dto.dupeProductId} not found`);

    const dupe = this.dupesRepo.create({
      originalProduct: original,
      dupeProduct: dupeProduct,
      similarityScore: dto.similarityScore,
      savingsPercent: dto.savingsPercent,
      category: dto.category,
      isFeatured: dto.isFeatured ?? false,
      isTrending: dto.isTrending ?? false,
      scoringMethod: dto.scoringMethod,
      scoreConfidence: dto.scoreConfidence,
      scoreVersion: dto.scoreVersion,
      scoreCalculatedAt: dto.scoreCalculatedAt,
    });
    const saved = await this.dupesRepo.save(dupe);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: Partial<CreateDupeDto>) {
    await this.findOne(id);
    const update: any = {};
    if (dto.similarityScore !== undefined) update.similarityScore = dto.similarityScore;
    if (dto.savingsPercent !== undefined) update.savingsPercent = dto.savingsPercent;
    if (dto.category !== undefined) update.category = dto.category;
    if (dto.isFeatured !== undefined) update.isFeatured = dto.isFeatured;
    if (dto.isTrending !== undefined) update.isTrending = dto.isTrending;
    if (dto.scoringMethod !== undefined) update.scoringMethod = dto.scoringMethod;
    if (dto.scoreConfidence !== undefined) update.scoreConfidence = dto.scoreConfidence;
    if (dto.scoreVersion !== undefined) update.scoreVersion = dto.scoreVersion;
    if (dto.scoreCalculatedAt !== undefined) update.scoreCalculatedAt = dto.scoreCalculatedAt;
    await this.dupesRepo.update(id, update);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.dupesRepo.delete(id);
  }

  /**
   * Get all dupes where the given product is the original (expensive) product,
   * ranked by dupeRank ASC (best match first).
   */
  async findByProduct(productId: string) {
    const dupes = await this.dupesRepo.find({
      where: { originalProduct: { id: productId } },
      relations: PRODUCT_RELATIONS,
      order: { dupeRank: 'ASC', similarityScore: 'DESC' },
    });
    if (!dupes.length) {
      // Also check if this product IS a dupe of something
      const asOriginal = await this.dupesRepo.find({
        where: { dupeProduct: { id: productId } },
        relations: PRODUCT_RELATIONS,
        order: { similarityScore: 'DESC' },
        take: 5,
      });
      return { role: 'dupe', dupes: asOriginal.map(mapDupe) };
    }
    return { role: 'original', dupes: dupes.map(mapDupe) };
  }

  async recalculateStats(dupeId: string) {
    const result = await this.dupesRepo
      .createQueryBuilder('dupe')
      .leftJoin('dupe.reviews', 'review')
      .select('COUNT(review.id)', 'totalVotes')
      .addSelect('COALESCE(AVG(review.rating), 0)', 'avgRating')
      .where('dupe.id = :dupeId', { dupeId })
      .getRawOne();

    await this.dupesRepo.update(dupeId, {
      totalVotes: parseInt(result.totalVotes) || 0,
      avgRating: parseFloat(result.avgRating) || 0,
    });
  }

  /**
   * Find dupes for a product with ingredient inclusion/exclusion filters
   * and re-rank based on skin type preferences
   */
  async findDupesWithIngredientFilters(dto: FilterDupesByIngredientsDto) {
    const original = await this.productsRepo.findOne({
      where: { id: dto.originalProductId },
    });
    if (!original) throw new NotFoundException(`Product ${dto.originalProductId} not found`);

    // Get all dupes for the original product
    const dupes = await this.dupesRepo.find({
      where: { originalProduct: { id: dto.originalProductId } },
      relations: PRODUCT_RELATIONS,
      order: { dupeRank: 'ASC' },
    });

    if (!dupes.length) {
      return { data: [], total: 0 };
    }

    // Filter based on include/exclude ingredients
    let filtered = dupes;

    if (dto.includeIngredients && dto.includeIngredients.length > 0) {
      const includeSet = new Set(dto.includeIngredients.map((i) => i.toLowerCase()));
      filtered = filtered.filter((d) => {
        const tokens = new Set((d.dupeProduct.ingredientsTokens || []).map((t) => t.toLowerCase()));
        const hasAll = Array.from(includeSet).every((inc) => tokens.has(inc));
        return hasAll;
      });
    }

    if (dto.excludeIngredients && dto.excludeIngredients.length > 0) {
      const excludeSet = new Set(dto.excludeIngredients.map((i) => i.toLowerCase()));
      filtered = filtered.filter((d) => {
        const tokens = new Set((d.dupeProduct.ingredientsTokens || []).map((t) => t.toLowerCase()));
        const hasNone = Array.from(excludeSet).every((exc) => !tokens.has(exc));
        return hasNone;
      });
    }

    // Score for skin type suitability if specified
    if (dto.forSkinType) {
      for (const dupe of filtered) {
        const skinScore = await this.ingredientsService.scoreForSkinType(
          dupe.dupeProduct.ingredientsTokens || [],
          dto.forSkinType as any,
        );
        (dupe as any).skinTypeAdjustedScore = skinScore;
      }

      // Re-sort by skin type score combined with similarity
      filtered.sort((a: any, b: any) => {
        const scoreA = (a.similarityScore / 100) * 0.6 + (a.skinTypeAdjustedScore / 100) * 0.4;
        const scoreB = (b.similarityScore / 100) * 0.6 + (b.skinTypeAdjustedScore / 100) * 0.4;
        return scoreB - scoreA;
      });
    }

    // Apply offset/limit
    const paginated = filtered.slice(dto.offset, dto.offset + (dto.limit || 10));

    return {
      data: paginated.map((d) => ({
        ...mapDupe(d),
        skinTypeAdjustedScore: (d as any).skinTypeAdjustedScore,
        ingredientMatches:
          dto.includeIngredients?.length || 0 +
          (filtered.length > 0 ? ` / ${dto.includeIngredients?.length || 0}` : ''),
      })),
      total: filtered.length,
      filters_applied: {
        includeCount: dto.includeIngredients?.length || 0,
        excludeCount: dto.excludeIngredients?.length || 0,
        forSkinType: dto.forSkinType,
      },
    };
  }

  /**
   * Compare ingredients between two products
   */
  async compareProductIngredients(dto: CompareIngredientsDto): Promise<IngredientComparisonResponseDto> {
    const product1 = await this.productsRepo.findOne({ where: { id: dto.productId1 } });
    if (!product1) throw new NotFoundException(`Product ${dto.productId1} not found`);

    const product2 = await this.productsRepo.findOne({ where: { id: dto.productId2 } });
    if (!product2) throw new NotFoundException(`Product ${dto.productId2} not found`);

    const tokens1 = product1.ingredientsTokens || [];
    const tokens2 = product2.ingredientsTokens || [];

    // Get ingredient comparison
    const { shared, uniqueList1, uniqueList2, sharedEffects } =
      await this.ingredientsService.compareIngredientLists(tokens1, tokens2);

    // Get detailed ingredient info
    const getIngredientEffects = async (names: string[]) => {
      const details = [];
      for (const name of names) {
        try {
          const ing = await this.ingredientsService.getIngredientInternal(name);
          if (ing) {
            details.push({
              name: ing.canonicalName,
              effects: ing.effects,
            });
          }
        } catch {
          // Skip if not found
        }
      }
      return details;
    };

    const [sharedDetailed, uniqueDetailed1, uniqueDetailed2] = await Promise.all([
      getIngredientEffects(shared),
      getIngredientEffects(uniqueList1),
      getIngredientEffects(uniqueList2),
    ]);

    // Get skin type comparison if specified
    let skinTypeComparison = undefined;
    if (dto.forSkinType) {
      const score1 = await this.ingredientsService.scoreForSkinType(tokens1, dto.forSkinType as any);
      const score2 = await this.ingredientsService.scoreForSkinType(tokens2, dto.forSkinType as any);
      skinTypeComparison = {
        product1_score_forSkinType: score1,
        product2_score_forSkinType: score2,
        betterFor: score1 > score2 ? 1 : score2 > score1 ? 2 : null,
      };
    }

    // Calculate overall similarity (simple Jaccard)
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    const overallSimilarity = union.size > 0 ? (intersection.size / union.size) * 100 : 0;

    // Calculate price per unit
    const getPricePerUnit = (product: Product): number | undefined => {
      if (!product.normalizedPriceInr || !product.size) return undefined;
      const price = Number(product.normalizedPriceInr);
      try {
        // Simple regex to extract numeric value from size string
        const match = product.size.match(/(\d+)/);
        if (match) {
          const sizeValue = parseFloat(match[1]);
          return price / sizeValue;
        }
      } catch {
        // Ignore parse errors
      }
      return undefined;
    };

    return {
      product1: {
        id: product1.id,
        name: product1.name,
        brand: product1.brand,
        price: Number(product1.price),
        currency: product1.currency || 'INR',
        imageUrl: product1.imageUrl,
      },
      product2: {
        id: product2.id,
        name: product2.name,
        brand: product2.brand,
        price: Number(product2.price),
        currency: product2.currency || 'INR',
        imageUrl: product2.imageUrl,
      },
      sharedIngredients: sharedDetailed,
      uniqueToProduct1: uniqueDetailed1,
      uniqueToProduct2: uniqueDetailed2,
      sharedEffects,
      effectDifferences: {
        onlyIn1: [],
        onlyIn2: [],
      },
      skinTypeComparison,
      pricePerUnit: {
        product1: getPricePerUnit(product1),
        product2: getPricePerUnit(product2),
      },
      overallSimilarity: Math.round(overallSimilarity),
    };
  }
}
