import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ScrapingService } from './scraping.service';
import { DupeEngineService } from '../dupes/dupe-engine.service';
import { StartScrapeDto } from './dto/start-scrape.dto';
import { UpdateScrapeScheduleDto } from './dto/update-scrape-schedule.dto';

// ── Auth-protected routes ──────────────────────────────────────────────────
@UseGuards(JwtAuthGuard)
@Controller('scraping')
export class ScrapingController {
  constructor(
    private readonly scrapingService: ScrapingService,
    private readonly dupeEngine: DupeEngineService,
  ) {}

  @Post('start')
  start(@Body() dto: StartScrapeDto) {
    return this.scrapingService.startScrape(dto);
  }

  @Post('schedule')
  updateSchedule(@Body() dto: UpdateScrapeScheduleDto) {
    return this.scrapingService.updateSchedule(dto);
  }

  @Get('status')
  status() {
    return this.scrapingService.getStatus();
  }

  @Get('jobs')
  listJobs(@Query('limit') limit?: number) {
    return this.scrapingService.listJobs(limit ? Number(limit) : 25);
  }
}

// ── Public preview routes (no auth — dev/inspection only) ─────────────────
import { Controller as Ctrl } from '@nestjs/common';

@Ctrl('scraping/preview')
export class ScrapingPreviewController {
  constructor(
    private readonly dupeEngine: DupeEngineService,
    private readonly scrapingService: ScrapingService,
  ) {}

  /**
   * GET /api/scraping/preview/detect-dupes?subcategory=moisturiser
   *
   * Runs dupe detection on ALL products in the DB and returns ranked candidates.
   * Optional ?subcategory= to filter results to one subcategory.
   * Nothing is written to the database.
   */
  @Get('detect-dupes')
  detectDupes(@Query('subcategory') subcategory?: string) {
    return this.dupeEngine.previewDetection(subcategory);
  }

  /**
   * POST /api/scraping/preview/parse-ingredients
   * Body: { "ingredients": "Aqua, Glycerin, Niacinamide, ...", "subcategory": "serum" }
   *
   * Tokenizes and normalizes a raw ingredient string and shows key actives.
   */
  @Post('parse-ingredients')
  parseIngredients(
    @Body('ingredients') ingredients: string,
    @Body('subcategory') subcategory: string = 'serum',
  ) {
    return this.dupeEngine.parseIngredients(ingredients ?? '', subcategory);
  }

  /**
   * GET /api/scraping/preview/products-with-ingredients
   *
   * Lists all products that have ingredient data — useful to verify the
   * scraper has populated the DB correctly.
   */
  @Get('products-with-ingredients')
  productsWithIngredients() {
    return this.scrapingService.listProductsWithIngredients();
  }
}
