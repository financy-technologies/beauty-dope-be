import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScrapingController, ScrapingPreviewController } from './scraping.controller';
import { ScrapingService } from './scraping.service';
import { ScrapeJob } from './entities/scrape-job.entity';
import { Product } from '../products/entities/product.entity';
import { IngredientParserService } from './ingredient-parser.service';
import { NykaaScraper } from './scrapers/nykaa.scraper';
import { SephoraScraper } from './scrapers/sephora.scraper';
import { UltaScraper } from './scrapers/ulta.scraper';
import { PurplleScraper } from './scrapers/purplle.scraper';
import { DupesModule } from '../dupes/dupes.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScrapeJob, Product]),
    DupesModule,   // re-exports DupeEngineService + its repositories
  ],
  controllers: [ScrapingController, ScrapingPreviewController],
  providers: [
    ScrapingService,
    IngredientParserService,
    NykaaScraper,
    SephoraScraper,
    UltaScraper,
    PurplleScraper,
  ],
  exports: [ScrapingService],
})
export class ScrapingModule {}
