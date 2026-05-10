import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScrapeJob } from './entities/scrape-job.entity';
import { StartScrapeDto } from './dto/start-scrape.dto';
import { UpdateScrapeScheduleDto } from './dto/update-scrape-schedule.dto';
import { Product } from '../products/entities/product.entity';
import { DupeEngineService } from '../dupes/dupe-engine.service';
import { IngredientParserService } from './ingredient-parser.service';
import { NykaaScraper } from './scrapers/nykaa.scraper';
import { SephoraScraper } from './scrapers/sephora.scraper';
import { UltaScraper } from './scrapers/ulta.scraper';
import { PurplleScraper } from './scrapers/purplle.scraper';
import { InnovistScraper } from './scrapers/innovist.scraper';
import { ScrapedProduct, ScrapeResult } from './scrapers/types';
import { IngredientsService } from '../ingredients/ingredients.service';
import { IngredientParserService as IngredientResolverService } from '../ingredients/ingredient-parser.service';

// INR / USD spot rate — update or inject from a live FX source
const USD_TO_INR = 83;

@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);

  private readonly allScrapers = {
    nykaa:    this.nykaaScraper,
    purplle:  this.purplleScraper,
    sephora:  this.sephoraScraper,
    ulta:     this.ultaScraper,
    innovist: this.innovistScraper,
  };

  private schedule = {
    cadence: 'daily',
    cron: String(CronExpression.EVERY_DAY_AT_2AM),
  };

  private isRunning = false;

  constructor(
    @InjectRepository(ScrapeJob)
    private readonly scrapeJobRepo: Repository<ScrapeJob>,
    @InjectRepository(Product)
    private readonly productsRepo: Repository<Product>,
    private readonly dupeEngine: DupeEngineService,
    private readonly ingredientParser: IngredientParserService,
    private readonly nykaaScraper: NykaaScraper,
    private readonly purplleScraper: PurplleScraper,
    private readonly sephoraScraper: SephoraScraper,
    private readonly ultaScraper: UltaScraper,
    private readonly innovistScraper: InnovistScraper,
    private readonly ingredientsService: IngredientsService,
    private readonly ingredientResolver: IngredientResolverService,
  ) {}

  // ─── Scheduler ────────────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDailyScheduledScrape() {
    if (this.schedule.cadence !== 'daily' || this.isRunning) return;

    await this.startScrape({
      sources: ['nykaa', 'purplle', 'sephora', 'ulta'],
      trigger: 'daily-scheduler',
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async startScrape(dto: StartScrapeDto) {
    const sources = dto.sources?.length
      ? dto.sources
      : ['nykaa', 'purplle', 'sephora', 'ulta'];

    const job = this.scrapeJobRepo.create({
      jobName: 'platform-product-scrape',
      source: sources.join(','),
      status: 'RUNNING',
      startedAt: new Date(),
    });
    const savedJob = await this.scrapeJobRepo.save(job);

    this.isRunning = true;

    // Run async so the HTTP response returns the job record immediately
    this.runPipeline(savedJob.id, sources).catch((err) => {
      this.logger.error(`Pipeline failed for job ${savedJob.id}:`, err);
    });

    return this.getJob(savedJob.id);
  }

  updateSchedule(dto: UpdateScrapeScheduleDto) {
    if (dto.cadence) this.schedule.cadence = dto.cadence;
    if (dto.cron) this.schedule.cron = dto.cron;
    return this.schedule;
  }

  /**
   * Fire ONE scraper for ONE subcategory, return raw results + diagnostics.
   * Nothing is written to the database.
   */
  async testScraper(
    source: string,
    category: string,
    subcategory: string,
    limit = 3,
  ): Promise<object> {
    const scraper = this.allScrapers[source as keyof typeof this.allScrapers];
    if (!scraper) {
      return {
        ok: false,
        error: `Unknown source "${source}". Valid: ${Object.keys(this.allScrapers).join(', ')}`,
      };
    }

    const startMs = Date.now();
    let products: ScrapedProduct[] = [];
    let error: string | null = null;

    try {
      products = await (scraper as any).scrapeSubcategory(category, subcategory);
    } catch (err: any) {
      error = err?.message ?? String(err);
    }

    const elapsedMs = Date.now() - startMs;
    const sample = products.slice(0, limit);

    return {
      ok: error === null,
      source,
      category,
      subcategory,
      elapsedMs,
      totalFound: products.length,
      error,
      // How many have ingredient data (the most important field)
      withIngredients: products.filter((p) => p.ingredients?.trim()).length,
      // Ingredient parse stats on sampled products
      sample: sample.map((p) => ({
        externalId: p.externalId,
        name: p.name,
        brand: p.brand,
        price: `${p.price} ${p.currency}`,
        size: p.size ?? null,
        quantity: p.quantity ?? null,
        sourceUrl: p.sourceUrl,
        ingredientRaw: p.ingredients?.slice(0, 120) ?? null,
        ingredientTokens: p.ingredients
          ? this.ingredientParser.parse(p.ingredients).slice(0, 10)
          : [],
        keyActives: p.ingredients
          ? [
              ...this.ingredientParser.extractKeyActives(
                this.ingredientParser.parse(p.ingredients),
                subcategory,
              ),
            ]
          : [],
      })),
    };
  }

  /**
   * Scrape ONE source / category / subcategory and upsert results to DB.
   */
  async scrapeAndSave(
    source: string,
    category: string,
    subcategory: string,
  ): Promise<{ ok: boolean; source: string; category: string; subcategory: string; created: number; updated: number; error?: string }> {
    const scraper = this.allScrapers[source as keyof typeof this.allScrapers];
    if (!scraper) {
      return { ok: false, source, category, subcategory, created: 0, updated: 0, error: `Unknown source "${source}". Valid: ${Object.keys(this.allScrapers).join(', ')}` };
    }

    let products: ScrapedProduct[] = [];
    try {
      products = await (scraper as any).scrapeSubcategory(category, subcategory);
    } catch (err: any) {
      return { ok: false, source, category, subcategory, created: 0, updated: 0, error: err?.message ?? String(err) };
    }

    let created = 0, updated = 0;
    for (const p of products) {
      const result = await this.upsertProduct(p);
      if (result.created) created++; else updated++;
    }

    return { ok: true, source, category, subcategory, created, updated };
  }

  async listProductsWithIngredients() {
    const products = await this.productsRepo.find({
      select: ['id', 'name', 'brand', 'price', 'currency', 'category', 'subcategory', 'ingredients', 'ingredientsTokens', 'platform'],
    });
    return products
      .filter((p) => p.ingredients || p.ingredientsTokens?.length)
      .map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        price: Number(p.price),
        currency: p.currency,
        platform: p.platform,
        category: p.category,
        subcategory: p.subcategory,
        ingredientCount: p.ingredientsTokens?.length ?? 0,
        ingredientsPreview: (p.ingredientsTokens ?? []).slice(0, 8),
        rawIngredients: p.ingredients?.slice(0, 200),
      }));
  }

  getStatus() {
    return { isRunning: this.isRunning, schedule: this.schedule };
  }

  async listJobs(limit = 25) {
    return this.scrapeJobRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getJob(id: string) {
    return this.scrapeJobRepo.findOne({ where: { id } });
  }

  // ─── Pipeline ─────────────────────────────────────────────────────────────

  /**
   * Full scrape → persist → detect-dupes pipeline.
   *
   * Runs in the background after startScrape() returns the job record.
   * Updates the ScrapeJob row with counts and final status.
   */
  private async runPipeline(jobId: string, sources: string[]): Promise<void> {
    let productsCreated = 0;
    let productsUpdated = 0;
    let dupesCreated = 0;

    try {
      // ── Phase 1: Scrape ──────────────────────────────────────────────────
      const results = await this.runScrapers(sources);

      // ── Phase 2: Persist products ────────────────────────────────────────
      for (const result of results) {
        for (const scraped of result.products) {
          const { created } = await this.upsertProduct(scraped);
          if (created) productsCreated++;
          else productsUpdated++;
        }
      }
      this.logger.log(
        `Persist complete. Created: ${productsCreated}, Updated: ${productsUpdated}`,
      );

      // ── Phase 3: Detect dupes ────────────────────────────────────────────
      const { created } = await this.dupeEngine.runFullDetection();
      dupesCreated = created;
      this.logger.log(`Dupe detection complete. New dupes: ${dupesCreated}`);

      await this.scrapeJobRepo.update(jobId, {
        status: 'SUCCESS',
        completedAt: new Date(),
        productsCreated,
        productsUpdated,
        dupesCreated,
      });
    } catch (error) {
      await this.scrapeJobRepo.update(jobId, {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /** Fan-out to each requested scraper. */
  private async runScrapers(sources: string[]): Promise<ScrapeResult[]> {
    const results: ScrapeResult[] = [];

    for (const source of sources) {
      const scraper = this.allScrapers[source as keyof typeof this.allScrapers];
      if (!scraper) {
        this.logger.warn(`Unknown scraper source: ${source}`);
        continue;
      }
      try {
        const result = await scraper.scrape();
        results.push(result);
      } catch (err) {
        this.logger.error(`Scraper ${source} threw: ${(err as Error).message}`);
      }
    }

    return results;
  }

  /**
   * Upsert a scraped product into the products table.
   *
   * Match key: externalId (platform::productId).
   * If found → update price, ingredients, image (things that may drift).
   * If new  → insert with tokenized ingredients.
   */
  async pushProducts(
    products: Partial<Product>[],
  ): Promise<{ created: number; updated: number }> {
    let created = 0, updated = 0;
    for (const p of products) {
      if (!p.externalId) continue;

      const tokens = p.ingredientsTokens?.length ? p.ingredientsTokens : [];
      const breakdown = await this.buildIngredientBreakdown(p.ingredients ?? null, tokens);

      const existing = await this.productsRepo.findOne({ where: { externalId: p.externalId } });
      if (existing) {
        await this.productsRepo.update(existing.id, {
          price: p.price ?? existing.price,
          normalizedPriceInr: p.normalizedPriceInr ?? existing.normalizedPriceInr,
          imageUrl: p.imageUrl ?? existing.imageUrl,
          ingredients: p.ingredients ?? existing.ingredients,
          ingredientsTokens: tokens.length ? tokens : existing.ingredientsTokens,
          quantity: p.quantity ?? existing.quantity,
          scrapedAt: p.scrapedAt ?? existing.scrapedAt,
          ...(breakdown ? { ingredientBreakdown: breakdown, skinTypeSuitability: breakdown.avgSkinTypeScores } : {}),
        });
        this.runDupeDetectionInBackground(existing.id);
        updated++;
      } else {
        const newProduct = this.productsRepo.create({
          ...p,
          ...(breakdown ? { ingredientBreakdown: breakdown, skinTypeSuitability: breakdown.avgSkinTypeScores } : {}),
        });
        const saved = await this.productsRepo.save(newProduct);
        this.runDupeDetectionInBackground(saved.id);
        created++;
      }
    }
    return { created, updated };
  }

  private runDupeDetectionInBackground(productId: string) {
    this.dupeEngine.detectDupesForProduct(productId).catch((err) => {
      this.logger.warn(`Background dupe detection failed for ${productId}: ${err.message}`);
    });
  }

  private async buildIngredientBreakdown(ingredientsRaw: string | null, tokens: string[]) {
    if (!ingredientsRaw && !tokens.length) return null;

    const parsed = ingredientsRaw
      ? await this.ingredientResolver.parseIngredientList(ingredientsRaw)
      : [];

    const recognizedTokens = parsed.filter((t) => !t.isUnknown);
    const canonicalNames = recognizedTokens
      .map((t) => t.canonicalName)
      .filter((n): n is string => !!n);

    const [categories, warnings, comedogenicity] = await Promise.all([
      this.ingredientsService.categorizeIngredients(canonicalNames),
      this.ingredientsService.identifyWarnings(canonicalNames),
      this.ingredientsService.getComedogenicityStats(canonicalNames),
    ]);

    const activesInTopFive = parsed
      .slice(0, 5)
      .filter((t) => !t.isUnknown && categories.actives.includes(t.canonicalName!))
      .length;

    const skinScores = await this.ingredientsService.computeWeightedSkinTypeScores(parsed);

    const lower = (ingredientsRaw ?? '').toLowerCase();

    return {
      tokenCount: parsed.length || tokens.length,
      recognizedCount: recognizedTokens.length,
      actives: categories.actives,
      humectants: categories.humectants,
      emollients: categories.emollients,
      preservatives: categories.preservatives,
      chelatingAgents: categories.chelatingAgents,
      comedogenicCount: comedogenicity.count,
      maxComedogenicity: comedogenicity.max,
      fungalAcneSafe: !warnings.fungalAcneUnsafe,
      pregnancySafe: !warnings.pregnancyUnsafe,
      activesInTopFive,
      avgSkinTypeScores: skinScores,
      hasFragrance: lower.includes('fragrance') || lower.includes('parfum'),
      hasAlcohol: lower.includes('alcohol denat') || lower.includes('sd alcohol'),
      hasParaben: lower.includes('paraben'),
    };
  }

  private async upsertProduct(
    scraped: ScrapedProduct,
  ): Promise<{ created: boolean }> {
    const existing = await this.productsRepo.findOne({
      where: { externalId: scraped.externalId },
    });

    const tokens = scraped.ingredients
      ? this.ingredientParser.parse(scraped.ingredients)
      : [];

    const normalizedPriceInr = this.toInr(scraped.price, scraped.currency);

    if (existing) {
      await this.productsRepo.update(existing.id, {
        price: scraped.price,
        normalizedPriceInr,
        imageUrl: scraped.imageUrl ?? existing.imageUrl,
        ingredients: scraped.ingredients ?? existing.ingredients,
        ingredientsTokens: tokens.length ? tokens : existing.ingredientsTokens,
        ...(scraped.quantity !== undefined && { quantity: scraped.quantity }),
        scrapedAt: scraped.scrapedAt,
      });
      return { created: false };
    }

    const product = this.productsRepo.create({
      name: scraped.name,
      brand: scraped.brand,
      price: scraped.price,
      currency: scraped.currency,
      normalizedPriceInr,
      imageUrl: scraped.imageUrl,
      platform: scraped.platform,
      store: scraped.store,
      category: scraped.category,
      subcategory: scraped.subcategory,
      size: scraped.size,
      quantity: scraped.quantity,
      ingredients: scraped.ingredients,
      ingredientsTokens: tokens,
      description: scraped.description,
      source: scraped.platform,
      externalId: scraped.externalId,
      sourceUrl: scraped.sourceUrl,
      scrapedAt: scraped.scrapedAt,
    });
    await this.productsRepo.save(product);
    return { created: true };
  }

  private toInr(price: number, currency: string): number {
    if (currency === 'INR') return price;
    if (currency === 'USD') return parseFloat((price * USD_TO_INR).toFixed(2));
    return price; // fallback: no conversion
  }
}
