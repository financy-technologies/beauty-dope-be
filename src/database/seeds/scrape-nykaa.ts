/**
 * Standalone scrape-and-save script.
 *
 * Usage:
 *   NYKAA_COOKIE="<cookie>" CATEGORY=skin SUBCATEGORY=anti-aging \
 *     ts-node -r tsconfig-paths/register src/database/seeds/scrape-nykaa.ts
 *
 * Reads NYKAA_COOKIE from env (or .env file).
 * Scrapes the specified category/subcategory and upserts products to MySQL.
 */
import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { NykaaScraper } from '../../scraping/scrapers/nykaa.scraper';
import { IngredientParserService } from '../../scraping/ingredient-parser.service';
import { Product } from '../../products/entities/product.entity';
import { ScrapeJob } from '../../scraping/entities/scrape-job.entity';
import { Dupe } from '../../dupes/entities/dupe.entity';
import { Review } from '../../reviews/entities/review.entity';
import { UserFavorite } from '../../favorites/entities/favorite.entity';
import { User } from '../../auth/entities/user.entity';
import { Profile } from '../../profiles/entities/profile.entity';
import { Category } from '../../categories/entities/category.entity';
import { ScrapedProduct } from '../../scraping/scrapers/types';

const CATEGORY    = process.env.CATEGORY    ?? 'skin';
const SUBCATEGORY = process.env.SUBCATEGORY ?? 'anti-aging';
const USD_TO_INR  = 83;

const ds = new DataSource({
  type: 'mysql',
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     parseInt(process.env.DB_PORT ?? '3306'),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME     ?? 'beautydope',
  entities: [Product, ScrapeJob, Dupe, Review, UserFavorite, User, Profile, Category],
  synchronize: false,
  logging: false,
});

async function upsert(
  repo: ReturnType<typeof ds.getRepository<Product>>,
  parser: IngredientParserService,
  scraped: ScrapedProduct,
): Promise<'created' | 'updated'> {
  const existing = await repo.findOne({ where: { externalId: scraped.externalId } });
  const tokens = scraped.ingredients ? parser.parse(scraped.ingredients) : [];
  const inr    = scraped.currency === 'USD'
    ? parseFloat((scraped.price * USD_TO_INR).toFixed(2))
    : scraped.price;

  if (existing) {
    await repo.update(existing.id, {
      price:              scraped.price,
      normalizedPriceInr: inr,
      imageUrl:           scraped.imageUrl ?? existing.imageUrl,
      ingredients:        scraped.ingredients ?? existing.ingredients,
      ingredientsTokens:  tokens.length ? tokens : existing.ingredientsTokens,
      scrapedAt:          scraped.scrapedAt,
    });
    return 'updated';
  }

  await repo.save(repo.create({
    name:               scraped.name,
    brand:              scraped.brand,
    price:              scraped.price,
    currency:           scraped.currency,
    normalizedPriceInr: inr,
    imageUrl:           scraped.imageUrl,
    platform:           scraped.platform,
    store:              scraped.store,
    category:           scraped.category,
    subcategory:        scraped.subcategory,
    size:               scraped.size,
    ingredients:        scraped.ingredients,
    ingredientsTokens:  tokens,
    description:        scraped.description,
    source:             scraped.platform,
    externalId:         scraped.externalId,
    sourceUrl:          scraped.sourceUrl,
    scrapedAt:          scraped.scrapedAt,
  }));
  return 'created';
}

async function main() {
  if (!process.env.NYKAA_COOKIE) {
    console.error('ERROR: NYKAA_COOKIE env var is not set.');
    process.exit(1);
  }

  console.log(`\nScraping Nykaa › ${CATEGORY} › ${SUBCATEGORY} ...`);
  const scraper = new NykaaScraper();
  const parser  = new IngredientParserService();

  const products = await (scraper as any).scrapeSubcategory(CATEGORY, SUBCATEGORY);
  console.log(`Scraped ${products.length} products.`);

  if (!products.length) {
    console.log('Nothing to save.');
    return;
  }

  console.log('Connecting to DB ...');
  await ds.initialize();
  const repo = ds.getRepository(Product);

  let created = 0, updated = 0;
  for (const p of products) {
    const action = await upsert(repo, parser, p);
    if (action === 'created') created++;
    else updated++;
    process.stdout.write('.');
  }
  console.log(`\nDone. Created: ${created}  Updated: ${updated}`);
  await ds.destroy();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
