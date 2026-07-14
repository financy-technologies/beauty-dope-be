/**
 * push-to-prod.mjs
 *
 * Reads all products from the LOCAL database and pushes them to the
 * PRODUCTION server in batches.
 *
 * Usage:
 *   node push-to-prod.mjs
 *
 * Env vars (or edit the constants below):
 *   PROD_URL    — production base URL  (default: https://api.skinevora.com)
 *   BATCH_SIZE  — products per request (default: 50)
 *   START_BATCH — 1-indexed batch number to resume from (default: 1)
 *   MAX_RETRIES — retries per batch on failure before giving up (default: 3)
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';

const PROD_URL    = process.env.PROD_URL    ?? 'https://api.skinevora.com';
const BATCH_SIZE  = Number(process.env.BATCH_SIZE ?? 50);
const START_BATCH = Number(process.env.START_BATCH ?? 1);
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? 3);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ENDPOINT = `${PROD_URL}/api/scraping/preview/push-products`;

// ── local DB config (reads from .env) ────────────────────────────────────────
const db = await mysql.createConnection({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME     ?? 'beautydope',
});

const [rows] = await db.query(`
  SELECT id, name, brand, price, currency, normalized_price_inr,
         image_url, platform, store, category, subcategory,
         size, quantity, ingredients, ingredients_tokens,
         description, source, external_id, source_url, scraped_at
  FROM products
  WHERE external_id IS NOT NULL
`);

await db.end();

console.log(`Found ${rows.length} products in local DB`);

// ── map DB rows → Product shape the API expects ───────────────────────────────
const products = rows.map(r => ({
  name:               r.name,
  brand:              r.brand,
  price:              Number(r.price),
  currency:           r.currency,
  normalizedPriceInr: Number(r.normalized_price_inr),
  imageUrl:           r.image_url,
  platform:           r.platform,
  store:              r.store,
  category:           r.category,
  subcategory:        r.subcategory,
  size:               r.size,
  quantity:           r.quantity,
  ingredients:        r.ingredients,
  ingredientsTokens:  (() => { try { return JSON.parse(r.ingredients_tokens ?? '[]'); } catch { return []; } })(),
  description:        r.description,
  source:             r.source,
  externalId:         r.external_id,
  sourceUrl:          r.source_url,
  scrapedAt:          r.scraped_at,
}));

// ── push in batches ───────────────────────────────────────────────────────────
let totalCreated = 0, totalUpdated = 0;

const totalBatches = Math.ceil(products.length / BATCH_SIZE);

for (let i = (START_BATCH - 1) * BATCH_SIZE; i < products.length; i += BATCH_SIZE) {
  const batch = products.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const res = await fetch(ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ products: batch }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} — ${await res.text()}`);
      }

      const { created, updated } = await res.json();
      totalCreated += created;
      totalUpdated += updated;
      console.log(`Batch ${batchNum}/${totalBatches} — created: ${created}, updated: ${updated}`);
      break;
    } catch (err) {
      if (attempt > MAX_RETRIES) {
        console.error(`Batch ${batchNum}/${totalBatches} FAILED after ${MAX_RETRIES} retries — ${err.message}`);
        console.error(`Resume with: START_BATCH=${batchNum} node push-to-prod.mjs`);
        process.exit(1);
      }
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 30000);
      console.warn(`Batch ${batchNum}/${totalBatches} attempt ${attempt} failed — ${err.message}. Retrying in ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }
}

console.log(`\nDone — total created: ${totalCreated}, total updated: ${totalUpdated}`);
