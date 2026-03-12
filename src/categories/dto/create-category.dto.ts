import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subcategories?: string[];

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
