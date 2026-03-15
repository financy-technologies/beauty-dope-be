/**
 * Scraper diagnostic tool.
 *
 * Usage:
 *   npm run test:scrapers
 *   SOURCE=nykaa npm run test:scrapers
 *   SOURCE=nykaa CATEGORY=skin SUBCATEGORY=serum LIMIT=2 npm run test:scrapers
 *
 * What this does:
 *  1. Probes the platform's known API endpoint to see the raw HTTP response
 *     (status code, content-type, whether Cloudflare/captcha blocked it)
 *  2. Tries to call scrapeSubcategory() and reports how many products came back
 *  3. Shows a parsed sample with ingredient tokens + key actives
 *
 * If a scraper returns 0 products:
 *  - Look at "Probe" section — it shows the HTTP status and first 300 chars
 *  - Status 403/429/503 or body containing "cloudflare" = blocked
 *  - Status 200 but unexpected JSON = endpoint has changed
 *  - Use Chrome DevTools (Network tab) on the live site to find the real endpoint
 *    and update the URL in the corresponding scraper file
 */

import 'reflect-metadata';
import { NykaaScraper } from './scrapers/nykaa.scraper';
import { PurplleScraper } from './scrapers/purplle.scraper';
import { SephoraScraper } from './scrapers/sephora.scraper';
import { UltaScraper } from './scrapers/ulta.scraper';
import { IngredientParserService } from './ingredient-parser.service';
import { ScrapedProduct } from './scrapers/types';
import { BaseScraper } from './scrapers/base.scraper';

// ─── Config ───────────────────────────────────────────────────────────────

const CATEGORY    = process.env.CATEGORY    ?? 'skin';
const SUBCATEGORY = process.env.SUBCATEGORY ?? 'moisturiser';
const LIMIT       = parseInt(process.env.LIMIT ?? '2', 10);
const SOURCE      = process.env.SOURCE;

// Known probe URLs — the first API call each scraper makes.
// Update these if you discover the endpoint has changed via DevTools.
const PROBE_URLS: Record<string, { url: string; params?: Record<string, any> }> = {
  nykaa: {
    url: 'https://www.nykaa.com/app-api/index.php/products/list',
    // Uses L1 category ID (12=Makeup). Requires NYKAA_COOKIE env var (bm_sz from browser).
    params: { category_id: 12, page_no: 1, ptype: 'plp', sort: 'popularity', dir: 'desc' },
  },
  purplle: {
    url: 'https://www.purplle.com/api/v3/category-listing',
    params: { slug: 'skin-care/moisturizers', page: 1, per_page: 5, sort: 'popularity' },
  },
  sephora: {
    url: 'https://www.sephora.com/api/catalog/search',
    params: { currentPage: 1, pageSize: 5, content: true, categoryId: 'moisturizers-cream', sortBy: 'TOP_SELLERS' },
  },
  ulta: {
    url: 'https://www.ulta.com/api/catalog/search',
    params: { Nrpp: 5, No: 0, N: 'moisturizers', sort: 'sort.toprated', format: 'json' },
  },
};

const SCRAPERS: Record<string, BaseScraper> = {
  nykaa:   new NykaaScraper(),
  purplle: new PurplleScraper(),
  sephora: new SephoraScraper(),
  ulta:    new UltaScraper(),
};

const parser = new IngredientParserService();

// ─── Helpers ──────────────────────────────────────────────────────────────

const c = (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`;
const green  = (s: string) => c(32, s);
const red    = (s: string) => c(31, s);
const yellow = (s: string) => c(33, s);
const cyan   = (s: string) => c(36, s);
const bold   = (s: string) => c(1,  s);
const dim    = (s: string) => c(2,  s);

function statusBadge(status: number) {
  if (status === 200) return green(`HTTP ${status}`);
  if (status === 429) return red(`HTTP ${status} (rate limited)`);
  if (status === 403) return red(`HTTP ${status} (forbidden)`);
  if (status === 503) return red(`HTTP ${status} (service unavailable)`);
  if (status === 0)   return red(`CONNECTION ERROR`);
  return yellow(`HTTP ${status}`);
}

function printProduct(p: ScrapedProduct, subcategory: string) {
  const tokens = p.ingredients ? parser.parse(p.ingredients) : [];
  const actives = p.ingredients ? [...parser.extractKeyActives(tokens, subcategory)] : [];
  console.log(`      Name        : ${p.name}`);
  console.log(`      Brand       : ${p.brand}`);
  console.log(`      Price       : ${p.price} ${p.currency}`);
  console.log(`      Size        : ${p.size || dim('—')}`);
  console.log(`      Quantity    : ${p.quantity !== undefined ? p.quantity : dim('—')}`);
  console.log(`      URL         : ${dim(p.sourceUrl)}`);
  if (p.ingredients) {
    const preview = p.ingredients.slice(0, 100);
    console.log(`      Ingredients : ${dim(preview)}${p.ingredients.length > 100 ? '…' : ''}`);
    console.log(`      Tokens      : [${tokens.slice(0, 8).join(', ')}${tokens.length > 8 ? ', …' : ''}] (${tokens.length} total)`);
    console.log(`      Key Actives : ${actives.length ? cyan(actives.join(', ')) : dim('none detected')}`);
  } else {
    console.log(`      Ingredients : ${yellow('⚠  NOT FOUND — scraper needs ingredient detail call')}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const targets = SOURCE ? { [SOURCE]: SCRAPERS[SOURCE] } : SCRAPERS;

  if (SOURCE && !SCRAPERS[SOURCE]) {
    console.error(red(`\nUnknown source "${SOURCE}". Valid: ${Object.keys(SCRAPERS).join(', ')}\n`));
    process.exit(1);
  }

  console.log(bold('\n╔══════════════════════════════════════╗'));
  console.log(bold('║     Scraper Connectivity Tester      ║'));
  console.log(bold('╚══════════════════════════════════════╝'));
  console.log(`  Category: ${cyan(CATEGORY)}   Subcategory: ${cyan(SUBCATEGORY)}   Limit: ${LIMIT}\n`);

  const summary: { name: string; status: string; products: number; ingPct: number }[] = [];

  for (const [name, scraper] of Object.entries(targets)) {
    console.log(bold(`┌── ${name.toUpperCase()} ─────────────────────────────`));

    // ── Step 1: Raw probe ─────────────────────────────────────────────────
    const probe = PROBE_URLS[name];
    if (probe) {
      process.stdout.write(`  Probing ${dim(probe.url.replace('https://', ''))} … `);
      const result = await (scraper as any).probe(probe.url, probe.params);

      console.log(statusBadge(result.status) + (result.blocked ? red('  ⚠ BLOCKED') : ''));
      console.log(`  Content-Type : ${result.contentType || dim('unknown')}`);
      if (result.blocked) {
        console.log(red(`  Reason       : Site blocked the request (bot protection / Cloudflare / rate limit)`));
        console.log(yellow(`  Fix          : Update endpoint via browser DevTools — see guide below`));
      }
      console.log(`  Body preview :\n${dim('  ' + result.bodyPreview.slice(0, 300).replace(/\n/g, '\n  '))}`);
      if (result.bodyPreview.length > 300) console.log(dim('  …'));
    }

    // ── Step 2: Full scrape attempt ───────────────────────────────────────
    console.log();
    process.stdout.write(`  Running scrapeSubcategory(${CATEGORY}, ${SUBCATEGORY}) … `);
    const t0 = Date.now();
    let products: ScrapedProduct[] = [];
    let scrapeError: string | null = null;

    try {
      products = await (scraper as any).scrapeSubcategory(CATEGORY, SUBCATEGORY);
    } catch (err: any) {
      scrapeError = err?.message ?? String(err);
    }

    const elapsed = Date.now() - t0;
    const withIng = products.filter((p) => p.ingredients?.trim()).length;
    const ingPct  = products.length ? Math.round((withIng / products.length) * 100) : 0;

    if (scrapeError) {
      console.log(red(`FAILED  (${elapsed}ms)`));
      console.log(red(`  Error: ${scrapeError}`));
      summary.push({ name, status: 'ERROR', products: 0, ingPct: 0 });
    } else if (products.length === 0) {
      console.log(yellow(`0 products  (${elapsed}ms)`));
      console.log(yellow(`  → Endpoint returned no data (blocked or changed)`));
      summary.push({ name, status: 'EMPTY', products: 0, ingPct: 0 });
    } else {
      const ingColor = ingPct >= 70 ? green : ingPct >= 30 ? yellow : red;
      console.log(
        green(`${products.length} products`) +
        `   ingredients: ${ingColor(`${withIng}/${products.length} (${ingPct}%)`)}` +
        dim(`   (${elapsed}ms)`),
      );

      const sample = products.slice(0, LIMIT);
      sample.forEach((p, i) => {
        console.log(`\n    ${dim(`[Product ${i + 1}/${sample.length}]`)}`);
        printProduct(p, SUBCATEGORY);
      });
      summary.push({ name, status: 'OK', products: products.length, ingPct });
    }

    console.log(bold('└───────────────────────────────────────\n'));
  }

  // ── Summary table ────────────────────────────────────────────────────────
  console.log(bold('SUMMARY'));
  console.log('  Source     Status    Products  Ingredients%');
  console.log('  ─────────  ────────  ────────  ────────────');
  for (const row of summary) {
    const st = row.status === 'OK' ? green('OK      ') : row.status === 'EMPTY' ? yellow('EMPTY   ') : red('ERROR   ');
    const ing = row.ingPct >= 70 ? green(`${row.ingPct}%`) : row.ingPct >= 30 ? yellow(`${row.ingPct}%`) : red(`${row.ingPct}%`);
    console.log(`  ${row.name.padEnd(9)}  ${st}  ${String(row.products).padStart(8)}  ${ing}`);
  }

  // ── DevTools guide ───────────────────────────────────────────────────────
  const hasEmpty = summary.some((r) => r.status !== 'OK');
  if (hasEmpty) {
    console.log(bold('\n──── How to find the correct API endpoint via DevTools ────'));
    console.log(`
  1. Open Chrome / Edge and go to the platform's category page, e.g.:
     Nykaa   → https://www.nykaa.com/skincare/moisturizers/c/3021
     Purplle → https://www.purplle.com/skin-care/moisturizers
     Sephora → https://www.sephora.com/shop/moisturizers-cream
     Ulta    → https://www.ulta.com/skin-care/face-moisturizers

  2. Open DevTools (F12) → Network tab → Filter: XHR / Fetch

  3. Scroll the page to trigger a product load

  4. Look for requests returning JSON arrays of products
     (usually the largest JSON response)

  5. Copy the Request URL + Query Params

  6. Update the corresponding file:
     Nykaa   → src/scraping/scrapers/nykaa.scraper.ts   (line ~46)
     Purplle → src/scraping/scrapers/purplle.scraper.ts (line ~54)
     Sephora → src/scraping/scrapers/sephora.scraper.ts (line ~55)
     Ulta    → src/scraping/scrapers/ulta.scraper.ts    (line ~52)

  7. Re-run: npm run test:scrapers
`);
  }

  console.log(bold('Done.\n'));
}

main().catch((err) => {
  console.error(red('Fatal:'), err);
  process.exit(1);
});
