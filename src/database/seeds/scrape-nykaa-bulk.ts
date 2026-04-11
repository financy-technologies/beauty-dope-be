/**
 * Nykaa Bulk Scraper → Remote DB
 *
 * Scrapes 4 skin categories end-to-end (all pages) and upserts every product
 * directly to the configured database as each page completes — no in-memory
 * buffering between pages, so it is safe to run even if the cookie expires
 * mid-way (you will keep everything collected up to that point).
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   NYKAA_COOKIE="bm_sz=<value>" \
 *   DB_HOST=<host> DB_PORT=3306 DB_USERNAME=<user> \
 *   DB_PASSWORD=<pass> DB_NAME=beautydope \
 *     ts-node -r tsconfig-paths/register \
 *       src/database/seeds/scrape-nykaa-bulk.ts
 *
 * Or via npm script:
 *   NYKAA_COOKIE="..." npm run scrape:nykaa:bulk
 *
 * ── Categories scraped ────────────────────────────────────────────────────
 *   cleanser    → https://www.nykaa.com/skin/cleansers/cleanser/c/8380             (25 pages)
 *   moisturiser → https://www.nykaa.com/skin/moisturizers/face-moisturizer-day-cream/c/8394  (88 pages)
 *   sunscreen   → https://www.nykaa.com/skin/sun-care/face-sunscreen/c/8429        (47 pages)
 *   serum       → https://www.nykaa.com/skin/serums/serums-essence/c/8397          (88 pages)
 *
 * ── Getting a fresh cookie ────────────────────────────────────────────────
 *   1. Open https://www.nykaa.com in Chrome
 *   2. DevTools → Application → Cookies → www.nykaa.com
 *   3. Copy the bm_sz cookie value (valid ~2 hours)
 *   4. Set: export NYKAA_COOKIE="bm_sz=<value>"
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

// ─── Category targets ─────────────────────────────────────────────────────────

interface Target {
  id: number;           // Nykaa numeric category ID (from the /c/<id> URL segment)
  category: string;     // Our canonical top-level category
  subcategory: string;  // Our canonical subcategory
  referer: string;      // Full category URL — used as the HTTP Referer header
  maxPages: number;     // Total pages at ?sort=popularity (verified from the site)
}

const TARGETS: Target[] = [
  {
    id:         8380,
    category:   'skin',
    subcategory:'cleanser',
    referer:    'https://www.nykaa.com/skin/cleansers/cleanser/c/8380',
    maxPages:   25,
  },
  {
    id:         8394,
    category:   'skin',
    subcategory:'moisturiser',
    referer:    'https://www.nykaa.com/skin/moisturizers/face-moisturizer-day-cream/c/8394',
    maxPages:   88,
  },
  {
    id:         8429,
    category:   'skin',
    subcategory:'sunscreen',
    referer:    'https://www.nykaa.com/skin/sun-care/face-sunscreen/c/8429',
    maxPages:   47,
  },
  {
    id:         8397,
    category:   'skin',
    subcategory:'serum',
    referer:    'https://www.nykaa.com/skin/serums/serums-essence/c/8397',
    maxPages:   88,
  },
];

// ─── DB connection ────────────────────────────────────────────────────────────

const USD_TO_INR = 83;

const ds = new DataSource({
  type:     'mysql',
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     parseInt(process.env.DB_PORT ?? '3306', 10),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME     ?? 'beautydope',
  entities: [Product, ScrapeJob, Dupe, Review, UserFavorite, User, Profile, Category],
  synchronize: false,
  logging:     false,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const c   = (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`;
const green  = (s: string) => c(32, s);
const red    = (s: string) => c(31, s);
const yellow = (s: string) => c(33, s);
const cyan   = (s: string) => c(36, s);
const bold   = (s: string) => c(1,  s);
const dim    = (s: string) => c(2,  s);

function fmt(n: number, width = 6): string {
  return String(n).padStart(width);
}

/**
 * Upsert a single scraped product.
 * Match key: externalId (nykaa::<productId>)
 *   • Existing → update price, image, ingredients, quantity
 *   • New      → full insert with tokenised ingredients
 */
async function upsert(
  repo:    ReturnType<typeof ds.getRepository<Product>>,
  parser:  IngredientParserService,
  scraped: ScrapedProduct,
): Promise<'created' | 'updated'> {
  const existing = await repo.findOne({ where: { externalId: scraped.externalId } });
  const tokens   = scraped.ingredients ? parser.parse(scraped.ingredients) : [];
  const inr      = scraped.currency === 'USD'
    ? parseFloat((scraped.price * USD_TO_INR).toFixed(2))
    : scraped.price;

  if (existing) {
    await repo.update(existing.id, {
      price:              scraped.price,
      normalizedPriceInr: inr,
      imageUrl:           scraped.imageUrl          ?? existing.imageUrl,
      ingredients:        scraped.ingredients       ?? existing.ingredients,
      ingredientsTokens:  tokens.length ? tokens    : existing.ingredientsTokens,
      ...(scraped.quantity !== undefined && { quantity: scraped.quantity }),
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
    quantity:           scraped.quantity,
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Pre-flight checks ──────────────────────────────────────────────────────
  if (!process.env.NYKAA_COOKIE) {
    console.error(red('\n✖  NYKAA_COOKIE env var is not set.'));
    console.error(dim('   Get it from Chrome → DevTools → Application → Cookies → www.nykaa.com → bm_sz'));
    process.exit(1);
  }

  console.log(bold('\n╔══════════════════════════════════════════════╗'));
  console.log(bold('║      Nykaa Bulk Scraper  →  Remote DB        ║'));
  console.log(bold('╚══════════════════════════════════════════════╝'));
  console.log(`  DB : ${cyan(`${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? '3306'}/${process.env.DB_NAME ?? 'beautydope'}`)}`);

  const totalPages = TARGETS.reduce((s, t) => s + t.maxPages, 0);
  const estProducts = totalPages * 20; // API returns ~20 per page
  console.log(`  Categories : ${TARGETS.map(t => cyan(t.subcategory)).join(', ')}`);
  console.log(`  Max pages  : ${totalPages}   (~${estProducts.toLocaleString()} products)`);
  console.log(dim('  Products are persisted per-page — safe to interrupt and resume.\n'));

  // ── Connect ────────────────────────────────────────────────────────────────
  process.stdout.write('  Connecting to DB … ');
  await ds.initialize();
  console.log(green('connected\n'));

  const scraper = new NykaaScraper();
  const parser  = new IngredientParserService();
  const repo    = ds.getRepository(Product);

  // ── Per-run totals ─────────────────────────────────────────────────────────
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors  = 0;

  const runStart = Date.now();

  // ── Iterate categories ─────────────────────────────────────────────────────
  for (const target of TARGETS) {
    console.log(bold(`┌── ${target.subcategory.toUpperCase()} `) +
      dim(`(id=${target.id}, up to ${target.maxPages} pages)`));

    let catCreated  = 0;
    let catUpdated  = 0;
    let catErrors   = 0;
    let pagesScraped = 0;
    const catStart  = Date.now();

    try {
      await scraper.scrapeDirectCategory(
        target.id,
        target.category,
        target.subcategory,
        target.referer,
        target.maxPages,

        // onBatch — called after each page is fully fetched
        async (batch: ScrapedProduct[]) => {
          pagesScraped++;
          let batchCreated = 0;
          let batchUpdated = 0;

          for (const product of batch) {
            try {
              const action = await upsert(repo, parser, product);
              if (action === 'created') batchCreated++;
              else batchUpdated++;
            } catch (err: any) {
              catErrors++;
              totalErrors++;
              console.error(
                red(`  ✖ upsert failed`) +
                dim(` [${product.externalId}] ${product.name.slice(0, 50)}: ${err?.message ?? err}`),
              );
            }
          }

          catCreated  += batchCreated;
          catUpdated  += batchUpdated;
          totalCreated += batchCreated;
          totalUpdated += batchUpdated;

          const elapsed = Math.round((Date.now() - catStart) / 1000);
          console.log(
            `  │  page ${String(pagesScraped).padStart(3)} ` +
            `products: ${fmt(batch.length, 3)}  ` +
            green(`+${batchCreated} new`) + `  ` +
            dim(`~${batchUpdated} updated`) + `  ` +
            dim(`[cat total: ${catCreated + catUpdated}  ${elapsed}s]`),
          );
        },
      );
    } catch (err: any) {
      console.error(red(`  ✖ scrape failed: ${err?.message ?? err}`));
      catErrors++;
      totalErrors++;
    }

    const catElapsed = ((Date.now() - catStart) / 1000).toFixed(1);
    const ingPct     = catCreated + catUpdated > 0
      ? '' // ingredient % not tracked at this level; NykaaScraper logs it internally
      : '';

    console.log(
      bold(`└── `) +
      `${target.subcategory}  ` +
      green(`created: ${catCreated}`) + `  ` +
      dim(`updated: ${catUpdated}`) + `  ` +
      (catErrors ? red(`errors: ${catErrors}  `) : '') +
      dim(`pages: ${pagesScraped}  time: ${catElapsed}s`) +
      ingPct + '\n',
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalElapsed = ((Date.now() - runStart) / 1000 / 60).toFixed(1);

  console.log(bold('╔══════════════════════════════════════════════╗'));
  console.log(bold('║                 FINAL SUMMARY                ║'));
  console.log(bold('╚══════════════════════════════════════════════╝'));
  console.log(`  ${green('Created')} : ${totalCreated.toLocaleString()} products`);
  console.log(`  ${dim('Updated')} : ${totalUpdated.toLocaleString()} products`);
  console.log(`  Total   : ${(totalCreated + totalUpdated).toLocaleString()} products`);
  if (totalErrors > 0) {
    console.log(`  ${red('Errors')}  : ${totalErrors}`);
  }
  console.log(`  Time    : ${totalElapsed} min\n`);

  await ds.destroy();
}

main().catch((err) => {
  console.error(red('\nFatal:'), err);
  process.exit(1);
});
