import { IsString, IsOptional, IsUUID, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class IngredientsQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  limit?: number = 50;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  offset?: number = 0;
}

export class AnalyzeIngredientsDto {
  @IsOptional()
  @IsString()
  raw?: string; // Raw ingredient string to parse

  @IsOptional()
  @IsString({ each: true })
  tokens?: string[]; // Pre-parsed tokens

  @IsOptional()
  @IsString()
  subcategory?: string; // Product type for context

  @IsOptional()
  @IsString()
  preferredSkinType?: string; // dry, oily, sensitive, combination, normal
}

export class IngredientAnalysisResponseDto {
  tokenCount: number;
  breakdown: {
    actives: IngredientDetailDto[];
    humectants: IngredientDetailDto[];
    emollients: IngredientDetailDto[];
    preservatives: IngredientDetailDto[];
    chelatingAgents: IngredientDetailDto[];
  };
  skinTypeSuitability: {
    dry: number;
    oily: number;
    sensitive: number;
    combination: number;
    normal: number;
  };
  recommendedFor: string[];
  warnings: {
    fungalAcneUnsafe: boolean;
    pregnancyUnsafe: boolean;
    irritants: string[];
    highComedogenicity: string[];
  };
  overallScore: number; // 0-100 quality score
  synergies: {
    betweenIngredients: Array<{ ingredient1: string; ingredient2: string }>;
  };
  conflicts: {
    avoidCombiningWith: Array<{ ingredient1: string; ingredient2: string }>;
  };
}

export class IngredientDetailDto {
  name: string;
  effects: string[];
  comedogenicity: number;
  warnings?: string[];
  skinTypeScores?: {
    dry: number;
    oily: number;
    sensitive: number;
    combination: number;
    normal: number;
  };
}

export class IngredientFetchDto {
  id: string;
  canonicalName: string;
  inciNames: string[];
  category: string;
  effects: string[];
  skinTypeScores: {
    dry: number;
    oily: number;
    sensitive: number;
    combination: number;
    normal: number;
  };
  comedogenicity: number;
  fungalAcneSafe: boolean;
  pregnancySafe: boolean;
  concentration?: {
    min?: number;
    max?: number;
    unit: string;
  };
  synergies?: string[];
  conflicts?: string[];
  description: string;
  sources?: string[];
}
