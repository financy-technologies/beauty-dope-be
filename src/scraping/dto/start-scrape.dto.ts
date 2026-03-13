import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

const SUPPORTED_SOURCES = ['sephora', 'ulta', 'nykaa', 'amazon-beauty', 'myntra-beauty'] as const;

export class StartScrapeDto {
  @IsOptional()
  @IsArray()
  @IsIn(SUPPORTED_SOURCES, { each: true })
  sources?: string[];

  @IsOptional()
  @IsString()
  trigger?: string;
}
