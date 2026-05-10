import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ingredient } from './entities/ingredient.entity';
import { IngredientsQueryDto, AnalyzeIngredientsDto, IngredientAnalysisResponseDto } from './dto/ingredient-query.dto';

@Injectable()
export class IngredientsService {
  // Ingredient category definitions (used in seed and enrichment)
  private readonly INGREDIENT_CATEGORIES = {
    ACTIVES: 'Active',
    HUMECTANTS: 'Humectant',
    EMOLLIENTS: 'Emollient',
    PRESERVATIVES: 'Preservative',
    CHELATING_AGENTS: 'Chelating Agent',
    BASE: 'Base',
  };

  constructor(
    @InjectRepository(Ingredient)
    private ingredientRepository: Repository<Ingredient>,
  ) {}

  /**
   * Fetch all ingredients with optional filtering and pagination
   */
  async findAll(query: IngredientsQueryDto) {
    const qb = this.ingredientRepository.createQueryBuilder('ing');

    if (query.category) {
      qb.where('ing.category = :category', { category: query.category });
    }

    if (query.search) {
      qb.andWhere(
        '(ing.canoncialName ILIKE :search OR CAST(ing.inciNames AS TEXT) ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    const total = await qb.getCount();

    const ingredients = await qb
      .orderBy('ing.canonicalName', 'ASC')
      .skip(query.offset)
      .take(query.limit)
      .getMany();

    return { total, ingredients };
  }

  /**
   * Fetch single ingredient by canonical name
   */
  async findByCanonicalName(canonicalName: string) {
    const ingredient = await this.ingredientRepository.findOne({
      where: { canonicalName: canonicalName.toLowerCase() },
      relations: ['ingredientEffects'],
    });

    if (!ingredient) {
      throw new NotFoundException(
        `Ingredient "${canonicalName}" not found`,
      );
    }

    return ingredient;
  }

  /**
   * Find ingredients matching a search query (by canonical name or INCI names)
   */
  async search(query: string) {
    const qb = this.ingredientRepository.createQueryBuilder('ing');

    qb.where('ing.canonicalName ILIKE :search', { search: `%${query.toLowerCase()}%` }).orWhere(
      'CAST(ing.inciNames AS TEXT) ILIKE :search',
      { search: `%${query.toLowerCase()}%` },
    );

    return qb.orderBy('ing.canonicalName', 'ASC').take(20).getMany();
  }

  /**
   * Get ingredient by canonical name (internal method)
   */
  async getIngredientInternal(canonicalName: string): Promise<Ingredient | null> {
    return this.ingredientRepository.findOne({
      where: { canonicalName: canonicalName.toLowerCase() },
    });
  }

  /**
   * Score a list of ingredient tokens for a given skin type (0-100)
   * Weighted by presence and skin type compatibility
   */
  async scoreForSkinType(
    tokens: string[],
    skinType: 'dry' | 'oily' | 'sensitive' | 'combination' | 'normal',
  ): Promise<number> {
    if (!tokens || tokens.length === 0) return 50; // Neutral score for empty

    const ingredients = await this.ingredientRepository.find({
      where: tokens.map((t) => ({ canonicalName: t.toLowerCase() })),
    });

    if (ingredients.length === 0) return 50;

    let totalScore = 0;
    for (const ing of ingredients) {
      totalScore += ing.skinTypeScores[skinType] || 50;
    }

    return Math.round(totalScore / ingredients.length);
  }

  /**
   * Get skin type compatibility scores for all 5 skin types
   */
  async computeSkinTypeSuitability(tokens: string[]): Promise<{
    dry: number;
    oily: number;
    sensitive: number;
    combination: number;
    normal: number;
  }> {
    if (!tokens || tokens.length === 0) {
      return {
        dry: 50,
        oily: 50,
        sensitive: 50,
        combination: 50,
        normal: 50,
      };
    }

    const ingredients = await this.ingredientRepository.find({
      where: tokens.map((t) => ({ canonicalName: t.toLowerCase() })),
    });

    if (ingredients.length === 0) {
      return {
        dry: 50,
        oily: 50,
        sensitive: 50,
        combination: 50,
        normal: 50,
      };
    }

    const result = {
      dry: 0,
      oily: 0,
      sensitive: 0,
      combination: 0,
      normal: 0,
    };

    for (const ing of ingredients) {
      result.dry += ing.skinTypeScores.dry;
      result.oily += ing.skinTypeScores.oily;
      result.sensitive += ing.skinTypeScores.sensitive;
      result.combination += ing.skinTypeScores.combination;
      result.normal += ing.skinTypeScores.normal;
    }

    return {
      dry: Math.round(result.dry / ingredients.length),
      oily: Math.round(result.oily / ingredients.length),
      sensitive: Math.round(result.sensitive / ingredients.length),
      combination: Math.round(result.combination / ingredients.length),
      normal: Math.round(result.normal / ingredients.length),
    };
  }

  /**
   * Categorize ingredients into their functional categories
   */
  async categorizeIngredients(
    tokens: string[],
  ): Promise<{
    actives: string[];
    humectants: string[];
    emollients: string[];
    preservatives: string[];
    chelatingAgents: string[];
    other: string[];
  }> {
    if (!tokens || tokens.length === 0) {
      return {
        actives: [],
        humectants: [],
        emollients: [],
        preservatives: [],
        chelatingAgents: [],
        other: [],
      };
    }

    const ingredients = await this.ingredientRepository.find({
      where: tokens.map((t) => ({ canonicalName: t.toLowerCase() })),
    });

    const result = {
      actives: [],
      humectants: [],
      emollients: [],
      preservatives: [],
      chelatingAgents: [],
      other: [],
    };

    for (const ing of ingredients) {
      switch (ing.category) {
        case this.INGREDIENT_CATEGORIES.ACTIVES:
          result.actives.push(ing.canonicalName);
          break;
        case this.INGREDIENT_CATEGORIES.HUMECTANTS:
          result.humectants.push(ing.canonicalName);
          break;
        case this.INGREDIENT_CATEGORIES.EMOLLIENTS:
          result.emollients.push(ing.canonicalName);
          break;
        case this.INGREDIENT_CATEGORIES.PRESERVATIVES:
          result.preservatives.push(ing.canonicalName);
          break;
        case this.INGREDIENT_CATEGORIES.CHELATING_AGENTS:
          result.chelatingAgents.push(ing.canonicalName);
          break;
        default:
          result.other.push(ing.canonicalName);
      }
    }

    return result;
  }

  /**
   * Identify warnings in an ingredient list
   */
  async identifyWarnings(tokens: string[]): Promise<{
    fungalAcneUnsafe: boolean;
    pregnancyUnsafe: boolean;
    irritants: string[];
    highComedogenicity: string[];
  }> {
    if (!tokens || tokens.length === 0) {
      return {
        fungalAcneUnsafe: false,
        pregnancyUnsafe: false,
        irritants: [],
        highComedogenicity: [],
      };
    }

    const ingredients = await this.ingredientRepository.find({
      where: tokens.map((t) => ({ canonicalName: t.toLowerCase() })),
    });

    const result = {
      fungalAcneUnsafe: false,
      pregnancyUnsafe: false,
      irritants: [] as string[],
      highComedogenicity: [] as string[],
    };

    for (const ing of ingredients) {
      if (!ing.fungalAcneSafe) result.fungalAcneUnsafe = true;
      if (!ing.pregnancySafe) result.pregnancyUnsafe = true;
      if (ing.comedogenicity >= 4) {
        result.highComedogenicity.push(ing.canonicalName);
      }
    }

    return result;
  }

  async getComedogenicityStats(tokens: string[]): Promise<{ count: number; max: number }> {
    if (!tokens?.length) return { count: 0, max: 0 };
    const ingredients = await this.ingredientRepository.find({
      where: tokens.map((t) => ({ canonicalName: t.toLowerCase() })),
    });
    let count = 0, max = 0;
    for (const ing of ingredients) {
      if (ing.comedogenicity > 0) count++;
      if (ing.comedogenicity > max) max = ing.comedogenicity;
    }
    return { count, max };
  }

  /**
   * Compare two ingredient token lists
   */
  async compareIngredientLists(
    tokens1: string[],
    tokens2: string[],
  ): Promise<{
    shared: string[];
    uniqueList1: string[];
    uniqueList2: string[];
    sharedEffects: string[];
  }> {
    const set1 = new Set(tokens1.map((t) => t.toLowerCase()));
    const set2 = new Set(tokens2.map((t) => t.toLowerCase()));

    const shared = Array.from(set1).filter((t) => set2.has(t));
    const uniqueList1 = Array.from(set1).filter((t) => !set2.has(t));
    const uniqueList2 = Array.from(set2).filter((t) => !set1.has(t));

    // Get effects from shared ingredients
    const sharedIngredients = await this.ingredientRepository.find({
      where: shared.map((s) => ({ canonicalName: s })),
    });

    const sharedEffects = new Set<string>();
    for (const ing of sharedIngredients) {
      ing.effects.forEach((e) => sharedEffects.add(e));
    }

    return {
      shared,
      uniqueList1,
      uniqueList2,
      sharedEffects: Array.from(sharedEffects),
    };
  }

  /**
   * Identify synergies and conflicts between ingredients
   */
  async identifySynergiesAndConflicts(tokens: string[]): Promise<{
    synergies: Array<{ ingredient1: string; ingredient2: string }>;
    conflicts: Array<{ ingredient1: string; ingredient2: string }>;
  }> {
    if (!tokens || tokens.length < 2) {
      return { synergies: [], conflicts: [] };
    }

    const ingredients = await this.ingredientRepository.find({
      where: tokens.map((t) => ({ canonicalName: t.toLowerCase() })),
    });

    const synergies: Array<{ ingredient1: string; ingredient2: string }> = [];
    const conflicts: Array<{ ingredient1: string; ingredient2: string }> = [];

    for (let i = 0; i < ingredients.length; i++) {
      for (let j = i + 1; j < ingredients.length; j++) {
        const ing1 = ingredients[i];
        const ing2 = ingredients[j];

        // Check synergies
        if (ing1.synergies?.includes(ing2.canonicalName)) {
          synergies.push({
            ingredient1: ing1.canonicalName,
            ingredient2: ing2.canonicalName,
          });
        }

        // Check conflicts
        if (ing1.conflicts?.includes(ing2.canonicalName) ||
            ing2.conflicts?.includes(ing1.canonicalName)) {
          conflicts.push({
            ingredient1: ing1.canonicalName,
            ingredient2: ing2.canonicalName,
          });
        }
      }
    }

    return { synergies, conflicts };
  }

  /**
   * Compute overall quality score for an ingredient list (0-100)
   * Based on thoughtful formulation, skin type suitability, and lack of conflicts
   */
  async computeOverallScore(
    tokens: string[],
    subcategory?: string,
    skinType?: string,
  ): Promise<number> {
    if (!tokens || tokens.length === 0) return 30; // Low score for empty

    const ingredients = await this.ingredientRepository.find({
      where: tokens.map((t) => ({ canonicalName: t.toLowerCase() })),
    });

    if (ingredients.length === 0) return 30;

    let score = 50; // Base score

    // Factor 1: Token diversity and count (more well-rounded formulation)
    const tokenFactor = Math.min(tokens.length * 5, 20); // Max 20 points
    score += tokenFactor;

    // Factor 2: Ingredient quality and evidence
    let qualitySum = 0;
    for (const ing of ingredients) {
      qualitySum += ing.skinTypeScores[skinType || 'normal'] || 50;
    }
    const qualityFactor = (qualitySum / ingredients.length - 50) * 0.3; // -15 to +15
    score += qualityFactor;

    // Factor 3: Conflicts penalty
    const { conflicts } = await this.identifySynergiesAndConflicts(tokens);
    score -= conflicts.length * 5; // -5 per conflict

    // Clamp to 0-100
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Enrich parsed tokens with full ingredient data
   * Used by IngredientParserService
   */
  async enrichTokensWithIngredientData(tokens: string[]) {
    if (!tokens || tokens.length === 0) return [];

    const ingredients = await this.ingredientRepository.find({
      where: tokens.map((t) => ({ canonicalName: t.toLowerCase() })),
    });

    return ingredients.map((ing) => ({
      canonicalName: ing.canonicalName,
      effects: ing.effects,
      comedogenicity: ing.comedogenicity,
      category: ing.category,
      skinTypeScores: ing.skinTypeScores,
      warnings: !ing.fungalAcneSafe
        ? ['Not safe for fungal acne']
        : !ing.pregnancySafe
          ? ['Not recommended during pregnancy']
          : [],
    }));
  }
}
