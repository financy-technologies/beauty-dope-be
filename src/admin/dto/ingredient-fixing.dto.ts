import { IsString, IsArray, IsOptional, IsNumber } from 'class-validator';

export class FuzzyMatchIngredientDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsNumber()
  threshold?: number; // 0-100, default 70
}

export class ManualMapIngredientDto {
  @IsString()
  productId: string;

  @IsString()
  unrecognizedToken: string;

  @IsString()
  mappedToCanonicalName: string;
}

export class BatchFixIngredientsDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];

  @IsOptional()
  @IsNumber()
  fuzzyThreshold?: number; // 0-100, default 70

  @IsOptional()
  autoFixOnly?: boolean; // if true, skip manual review
}

export class CreateIngredientDto {
  @IsString()
  canonicalName: string;

  @IsArray()
  @IsString({ each: true })
  inciNames: string[];

  @IsString()
  category: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  effects?: string[];

  @IsOptional()
  @IsString()
  description?: string;
}

export class FuzzyMatchResult {
  ingredient: string;
  matches: Array<{
    canonicalName: string;
    id: string;
    similarity: number; // 0-100
  }>;
}

export class UnrecognizedIngredient {
  token: string;
  position: number;
  suggestions: Array<{
    canonicalName: string;
    id: string;
    similarity: number;
  }>;
}

export class BatchFixResult {
  productId: string;
  fixed: boolean;
  autoFixed: number;
  manualReviewNeeded: number;
  unrecognized: UnrecognizedIngredient[];
}
