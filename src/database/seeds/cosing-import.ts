/**
 * Ingredient Import Script — Open Beauty Facts API
 *
 * Fetches real cosmetic products from the Open Beauty Facts public API,
 * extracts all unique ingredient names, and imports them into the DB.
 *
 * - No file download needed — calls the API directly
 * - Free, no API key required
 * - Real-world ingredient strings from actual product labels
 * - Auto-throttled to avoid rate limits
 *
 * HOW TO USE:
 *   npx ts-node -r tsconfig-paths/register src/database/seeds/cosing-import.ts
 */

import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Ingredient } from '../../ingredients/entities/ingredient.entity';
import { IngredientAlias } from '../../ingredients/entities/ingredient-alias.entity';
import { IngredientEffect } from '../../ingredients/entities/ingredient-effect.entity';

// Open Beauty Facts API — no auth required, ODbL licence
const OBF_BASE = 'https://world.openbeautyfacts.org/cgi/search.pl';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;   // ~5000 products → thousands of unique ingredients
const DELAY_MS = 300;   // stay within rate limits

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function deriveCategory(name: string): string {
  const n = name.toLowerCase();
  if (/acid|retinol|niacinamide|ascorb|peptide|vitamin|salicyl|glycolic|lactic|azelaic|kojic|bakuchiol/.test(n)) return 'Active';
  if (/hyaluronic|hyaluronate|glycerin|glycerol|propylene|sorbitol|betaine|urea|panthenol|sodium pca/.test(n)) return 'Humectant';
  if (/oil$| oil |butter$|squalane|jojoba|argan|cetyl|stearyl|dimethicone|cyclomethicone|isopropyl/.test(n)) return 'Emollient';
  if (/phenoxyethanol|paraben|benzoate|sorbate|chlorphenesin|isothiazolinone|dehydroacetic/.test(n)) return 'Preservative';
  if (/parfum|fragrance|linalool|geraniol|citronellol|limonene|eugenol/.test(n)) return 'Fragrance';
  if (/zinc oxide|titanium dioxide|avobenzone|octocrylene|mexoryl|tinosorb/.test(n)) return 'UV Filter';
  if (/sodium hydroxide|citric acid|lactic acid$|triethanolamine|arginine$|lysine$/.test(n)) return 'pH Adjuster';
  if (/^aqua$|^water$|deionized water|purified water|distilled water/.test(n)) return 'Base';
  if (/carbomer|xanthan|guar|cellulose|acrylate|polymer|resin/.test(n)) return 'Texture Agent';
  if (/lecithin|polysorbate|sorbitan|lauryl|laureth|coco-glucoside|decyl glucoside/.test(n)) return 'Emulsifier';
  return 'Other';
}

function toCanonicalName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

// Split a raw INCI string into individual ingredient tokens
function splitInciList(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;

  for (const ch of raw) {
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth = Math.max(0, depth - 1); current += ch; }
    else if (ch === ',' && depth === 0) {
      const t = current.trim();
      if (t) tokens.push(t);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

// Clean a raw ingredient token: strip percentages, brackets, trailing numbers
function cleanIngredientName(raw: string): string {
  return raw
    .replace(/\(?\d+(?:\.\d+)?\s*%\)?/g, '')   // remove "10%" or "(10%)"
    .replace(/\[[^\]]*\]/g, '')                   // remove "[...]"
    .replace(/\s+/g, ' ')
    .trim();
}

const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'beautydope',
  entities: [Ingredient, IngredientAlias, IngredientEffect],
  synchronize: false,
});

async function fetchPage(page: number): Promise<string[]> {
  const url =
    `${OBF_BASE}?action=process&json=1` +
    `&page_size=${PAGE_SIZE}&page=${page}` +
    `&fields=ingredients_text`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'BeautyDope-IngredientImporter/1.0' },
  });

  if (!res.ok) return [];

  const data = await res.json() as { products?: Array<{ ingredients_text?: string }> };
  const ingredientStrings: string[] = [];

  for (const product of data.products ?? []) {
    if (product.ingredients_text?.trim()) {
      ingredientStrings.push(product.ingredients_text);
    }
  }

  return ingredientStrings;
}

async function importFromOBF() {
  await AppDataSource.initialize();
  const ingredientRepo = AppDataSource.getRepository(Ingredient);
  const aliasRepo     = AppDataSource.getRepository(IngredientAlias);

  console.log('🌐 Fetching products from Open Beauty Facts API...');
  console.log(`   Pages: ${MAX_PAGES} × ${PAGE_SIZE} products = up to ${MAX_PAGES * PAGE_SIZE} products\n`);

  // Collect all unique cleaned ingredient names across all pages
  const uniqueNames = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    process.stdout.write(`  Page ${page}/${MAX_PAGES}...`);

    const ingredientStrings = await fetchPage(page);
    if (!ingredientStrings.length) {
      console.log(' (empty — stopping)');
      break;
    }

    for (const raw of ingredientStrings) {
      for (const token of splitInciList(raw)) {
        const cleaned = cleanIngredientName(token);
        if (cleaned.length >= 2 && cleaned.length <= 120) {
          uniqueNames.add(cleaned.toLowerCase());
        }
      }
    }

    console.log(` ${ingredientStrings.length} products — ${uniqueNames.size} unique ingredients so far`);
    await sleep(DELAY_MS);
  }

  console.log(`\n📋 Total unique ingredient names extracted: ${uniqueNames.size}`);
  console.log('💾 Importing into database...\n');

  let imported = 0;
  let skipped = 0;
  let aliasesAdded = 0;

  for (const name of uniqueNames) {
    const canonicalName = toCanonicalName(name);
    if (!canonicalName || canonicalName.length < 2) continue;

    // Skip if already in DB
    const existing = await ingredientRepo.findOne({ where: { canonicalName } });
    if (existing) {
      // Add as alias if not already present
      const aliasText = name.trim();
      const aliasExists = await aliasRepo.findOne({ where: { aliasText } });
      if (!aliasExists) {
        await aliasRepo.save({ aliasText, aliasType: 'inci', ingredientId: existing.id });
        aliasesAdded++;
      }
      skipped++;
      continue;
    }

    const category = deriveCategory(name);

    const ingredient = ingredientRepo.create({
      canonicalName,
      status: 'auto_imported',
      inciNames: [name],
      category,
      effects: [],
      skinTypeScores: { dry: 50, oily: 50, sensitive: 50, combination: 50, normal: 50 },
      comedogenicity: 0,
      fungalAcneSafe: true,
      pregnancySafe: true,
      description: `${name} — auto-imported from Open Beauty Facts.`,
      sources: ['Open Beauty Facts'],
    });

    const saved = await ingredientRepo.save(ingredient);
    imported++;

    // Save the raw name as an alias too
    const aliasText = name.trim();
    const aliasExists = await aliasRepo.findOne({ where: { aliasText } });
    if (!aliasExists) {
      await aliasRepo.save({ aliasText, aliasType: 'inci', ingredientId: saved.id });
      aliasesAdded++;
    }

    if (imported % 200 === 0) {
      console.log(`  ✅ ${imported} imported...`);
    }
  }

  await AppDataSource.destroy();

  console.log('\n🎉 Import complete!');
  console.log(`   New ingredients:     ${imported}`);
  console.log(`   Already existed:     ${skipped}`);
  console.log(`   Aliases added:       ${aliasesAdded}`);
  console.log('\nNext — run PubChem enrichment to add synonyms:');
  console.log('  npx ts-node -r tsconfig-paths/register src/database/seeds/pubchem-enrichment.ts');
}

importFromOBF().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
