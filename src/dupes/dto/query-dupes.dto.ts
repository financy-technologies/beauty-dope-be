import { IsOptional, IsString, IsInt, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryDupesDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;

  @IsOptional()
  @IsIn(['created_at', 'similarity', 'savings', 'rating', 'trending'])
  sort?: string = 'created_at';
}
