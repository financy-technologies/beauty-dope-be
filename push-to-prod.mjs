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
 *   PROD_URL   — production base URL  (default: https://beautydupe.servehttp.com)
 *   BATCH_SIZE — products per request (default: 50)
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';

const PROD_URL   = process.env.PROD_URL   ?? 'https://beautydupe.servehttp.com';
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 50);

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

for (let i = 0; i < products.length; i += BATCH_SIZE) {
  const batch = products.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(products.length / BATCH_SIZE);

  const res = await fetch(ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ products: batch }),
  });

  if (!res.ok) {
    console.error(`Batch ${batchNum}/${totalBatches} FAILED — HTTP ${res.status}`);
    console.error(await res.text());
    process.exit(1);
  }

  const { created, updated } = await res.json();
  totalCreated += created;
  totalUpdated += updated;
  console.log(`Batch ${batchNum}/${totalBatches} — created: ${created}, updated: ${updated}`);
}

console.log(`\nDone — total created: ${totalCreated}, total updated: ${totalUpdated}`);
