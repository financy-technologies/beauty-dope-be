import { IsUUID, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class UpsertReviewDto {
  @IsUUID()
  dupeId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
