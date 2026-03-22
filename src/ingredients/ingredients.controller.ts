import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { IngredientsService } from './ingredients.service';
import {
  IngredientsQueryDto,
  AnalyzeIngredientsDto,
  IngredientAnalysisResponseDto,
  IngredientDetailDto,
} from './dto/ingredient-query.dto';

@Controller('ingredients')
export class IngredientsController {
  constructor(private readonly ingredientsService: IngredientsService) {}

  /**
   * GET /api/ingredients
   * List all ingredients with optional filtering and pagination
   */
  @Get()
  async findAll(@Query() query: IngredientsQueryDto) {
    return this.ingredientsService.findAll(query);
  }

  /**
   * GET /api/ingredients/search?q=vitamin
   * Search ingredients by canonical name or INCI variants
   */
  @Get('search')
  async search(@Query('q') q: string) {
    if (!q || q.length < 2) {
      throw new BadRequestException('Search query must be at least 2 characters');
    }
    return this.ingredientsService.search(q);
  }

  /**
   * POST /api/ingredients/analyze
   * Analyze an ingredient list with detailed feedback
   */
  @Post('analyze')
  async analyze(@Body() dto: AnalyzeIngredientsDto): Promise<IngredientAnalysisResponseDto> {
    const ingredientParserService = require('../scraping/ingredient-parser.service').IngredientParserService;

    // Parse raw ingredient string if provided
    let tokens = dto.tokens || [];
    if (dto.raw && !tokens.length) {
      // Use the ingredient parser to tokenize
      const parser = new ingredientParserService();
      tokens = parser.parseIngredientsFromRaw(dto.raw);
    }

    if (!tokens || tokens.length === 0) {
      throw new BadRequestException('No ingredients provided or could not parse ingredients');
    }

    // Categorize ingredients
    const breakdown = await this.ingredientsService.categorizeIngredients(tokens);

    // Get ingredient details for each category
    const getIngredientDetails = async (
      names: string[],
    ): Promise<IngredientDetailDto[]> => {
      const details = [];
      for (const name of names) {
        try {
          const ing = await this.ingredientsService.getIngredientInternal(name);
          if (ing) {
            details.push({
              name: ing.canonicalName,
              effects: ing.effects,
              comedogenicity: ing.comedogenicity,
              warnings: !ing.fungalAcneSafe || !ing.pregnancySafe ? ['Check warnings'] : [],
              skinTypeScores: ing.skinTypeScores,
            });
          }
        } catch {
          // Skip if ingredient not found
        }
      }
      return details;
    };

    const [actives, humectants, emollients, preservatives, chelatingAgents] = await Promise.all([
      getIngredientDetails(breakdown.actives),
      getIngredientDetails(breakdown.humectants),
      getIngredientDetails(breakdown.emollients),
      getIngredientDetails(breakdown.preservatives),
      getIngredientDetails(breakdown.chelatingAgents),
    ]);

    // Get skin type suitability
    const skinTypeSuitability = await this.ingredientsService.computeSkinTypeSuitability(tokens);

    // Get warnings
    const warnings = await this.ingredientsService.identifyWarnings(tokens);

    // Get recommended skin types
    const recommendedFor = Object.entries(skinTypeSuitability)
      .filter(([_, score]) => score >= 70)
      .map(([type, _]) => type);

    // Get synergies and conflicts
    const { synergies, conflicts } = await this.ingredientsService.identifySynergiesAndConflicts(tokens);

    // Get overall score
    const overallScore = await this.ingredientsService.computeOverallScore(
      tokens,
      dto.subcategory,
      dto.preferredSkinType,
    );

    return {
      tokenCount: tokens.length,
      breakdown: {
        actives,
        humectants,
        emollients,
        preservatives,
        chelatingAgents,
      },
      skinTypeSuitability,
      recommendedFor,
      warnings: {
        fungalAcneUnsafe: warnings.fungalAcneUnsafe,
        pregnancyUnsafe: warnings.pregnancyUnsafe,
        irritants: warnings.irritants,
        highComedogenicity: warnings.highComedogenicity,
      },
      overallScore,
      synergies: { betweenIngredients: synergies },
      conflicts: { avoidCombiningWith: conflicts },
    };
  }

  /**
   * GET /api/ingredients/:canonicalName
   * Get full details for a single ingredient
   */
  @Get(':canonicalName')
  async findByCanonicalName(@Param('canonicalName') canonicalName: string) {
    return this.ingredientsService.findByCanonicalName(canonicalName);
  }
}
