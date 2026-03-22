import { IsUUID, IsOptional, IsString, IsArray, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class FilterDupesByIngredientsDto {
  @IsUUID()
  originalProductId: string;

  @IsOptional()
  @IsString({ each: true })
  includeIngredients?: string[]; // Canonical names of ingredients dupe MUST have

  @IsOptional()
  @IsString({ each: true })
  excludeIngredients?: string[]; // Canonical names of ingredients dupe MUST NOT have

  @IsString()
  forSkinType: 'dry' | 'oily' | 'sensitive' | 'combination' | 'normal';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  minSimilarityScore?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  offset?: number = 0;
}

export class CompareIngredientsDto {
  @IsUUID()
  productId1: string;

  @IsUUID()
  productId2: string;

  @IsOptional()
  @IsString()
  forSkinType?: string; // dry, oily, sensitive, combination, normal
}

export class IngredientComparisonResponseDto {
  product1: {
    id: string;
    name: string;
    brand: string;
    price: number;
    currency: string;
    imageUrl?: string;
  };
  product2: {
    id: string;
    name: string;
    brand: string;
    price: number;
    currency: string;
    imageUrl?: string;
  };
  sharedIngredients: Array<{
    name: string;
    effects: string[];
  }>;
  uniqueToProduct1: Array<{
    name: string;
    effects: string[];
  }>;
  uniqueToProduct2: Array<{
    name: string;
    effects: string[];
  }>;
  sharedEffects: string[];
  effectDifferences: {
    onlyIn1: string[];
    onlyIn2: string[];
  };
  skinTypeComparison?: {
    product1_score_forSkinType: number;
    product2_score_forSkinType: number;
    betterFor: 1 | 2 | null; // null if equal
  };
  pricePerUnit: {
    product1?: number;
    product2?: number;
  };
  overallSimilarity: number;
}
