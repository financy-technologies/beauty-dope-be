/**
 * Innovist Bulk Scraper → Remote DB
 *
 * Scrapes all 4 skin subcategories from innovist.com (Shopify store) and
 * upserts every product directly to the configured database.
 *
 * No cookie or API key required — Shopify's JSON collection endpoint
 * is publicly accessible.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   DB_HOST=<host> DB_PORT=3306 DB_USERNAME=root \
 *   DB_PASSWORD=<pass> DB_NAME=beautydope \
 *     npm run scrape:innovist:bulk
 *
 * ── Collections scraped ────────────────────────────────────────────────────
 *   cleanser    → /collections/face-washes
 *   moisturiser → /collections/moisturizers + /collections/ceramide-based-moisturizers
 *   sunscreen   → /collections/sunscoop
 *   serum       → /collections/face-serum
 */

import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InnovistScraper } from '../../scraping/scrapers/innovist.scraper';
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

// ─── Targets ─────────────────────────────────────────────────────────────────

interface Target {
  category:   string;
  subcategory: string;
}

const TARGETS: Target[] = [
  { category: 'skin', subcategory: 'cleanser'    },
  { category: 'skin', subcategory: 'moisturiser' },
  { category: 'skin', subcategory: 'sunscreen'   },
  { category: 'skin', subcategory: 'serum'        },
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const c      = (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`;
const green  = (s: string) => c(32, s);
const red    = (s: string) => c(31, s);
const cyan   = (s: string) => c(36, s);
const bold   = (s: string) => c(1,  s);
const dim    = (s: string) => c(2,  s);

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
      description:        scraped.description       ?? existing.description,
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
  console.log(bold('\n╔══════════════════════════════════════════════╗'));
  console.log(bold('║   Innovist Bulk Scraper  →  Remote DB        ║'));
  console.log(bold('╚══════════════════════════════════════════════╝'));
  console.log(`  DB  : ${cyan(`${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? '3306'}/${process.env.DB_NAME ?? 'beautydope'}`)}`);
  console.log(`  Src : ${cyan('innovist.com (Shopify — no cookie needed)')}\n`);

  process.stdout.write('  Connecting to DB … ');
  await ds.initialize();
  console.log(green('connected\n'));

  const scraper = new InnovistScraper();
  const parser  = new IngredientParserService();
  const repo    = ds.getRepository(Product);

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors  = 0;
  const runStart   = Date.now();

  for (const target of TARGETS) {
    console.log(
      bold(`┌── ${target.subcategory.toUpperCase()}`) +
      dim(` (skin → ${target.subcategory})`),
    );
    const catStart = Date.now();
    let catCreated = 0;
    let catUpdated = 0;

    let products: ScrapedProduct[] = [];
    try {
      products = await (scraper as any).scrapeSubcategory(target.category, target.subcategory);
    } catch (err: any) {
      console.error(red(`  ✖ scrape failed: ${err?.message ?? err}`));
      totalErrors++;
      console.log(bold(`└──\n`));
      continue;
    }

    console.log(dim(`  Scraped ${products.length} products — pushing to DB…`));

    for (const p of products) {
      try {
        const action = await upsert(repo, parser, p);
        if (action === 'created') { catCreated++; totalCreated++; }
        else                      { catUpdated++; totalUpdated++; }
        process.stdout.write('.');
      } catch (err: any) {
        totalErrors++;
        console.error(red(`\n  ✖ upsert [${p.externalId}]: ${err?.message ?? err}`));
      }
    }

    const withIng  = products.filter((p) => p.ingredients?.trim()).length;
    const ingPct   = products.length ? Math.round((withIng / products.length) * 100) : 0;
    const elapsed  = ((Date.now() - catStart) / 1000).toFixed(1);

    console.log(
      `\n` +
      bold(`└── `) +
      green(`+${catCreated} new`) + `  ` +
      dim(`~${catUpdated} updated`) + `  ` +
      `ingredients: ${ingPct}%  ` +
      dim(`time: ${elapsed}s\n`),
    );
  }

  const totalElapsed = ((Date.now() - runStart) / 1000 / 60).toFixed(1);

  console.log(bold('╔══════════════════════════════════════════════╗'));
  console.log(bold('║                 FINAL SUMMARY                ║'));
  console.log(bold('╚══════════════════════════════════════════════╝'));
  console.log(`  ${green('Created')} : ${totalCreated.toLocaleString()} products`);
  console.log(`  ${dim('Updated')} : ${totalUpdated.toLocaleString()} products`);
  console.log(`  Total   : ${(totalCreated + totalUpdated).toLocaleString()} products`);
  if (totalErrors > 0) console.log(`  ${red('Errors')}  : ${totalErrors}`);
  console.log(`  Time    : ${totalElapsed} min\n`);

  await ds.destroy();
}

main().catch((err) => {
  console.error(red('\nFatal:'), err);
  process.exit(1);
});
