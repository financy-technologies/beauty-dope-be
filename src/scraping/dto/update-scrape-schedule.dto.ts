import { IsIn, IsOptional, IsString } from 'class-validator';

const SCHEDULE_OPTIONS = ['manual', 'hourly', 'daily', 'weekly'] as const;

export class UpdateScrapeScheduleDto {
  @IsOptional()
  @IsString()
  @IsIn(SCHEDULE_OPTIONS)
  cadence?: string;

  @IsOptional()
  @IsString()
  cron?: string;
}
