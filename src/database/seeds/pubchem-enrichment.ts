/**
 * PubChem Synonym Enrichment Script
 *
 * Queries the free PubChem REST API to fetch synonyms for every ingredient
 * in your database (using CAS number or INCI name), then saves them as
 * IngredientAlias records.
 *
 * HOW TO USE:
 * Run AFTER importing CosIng:
 *   npx ts-node -r tsconfig-paths/register src/database/seeds/pubchem-enrichment.ts
 *
 * Rate limit: PubChem allows ~5 req/sec. Script auto-throttles to 4 req/sec.
 */

import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Ingredient } from '../../ingredients/entities/ingredient.entity';
import { IngredientAlias } from '../../ingredients/entities/ingredient-alias.entity';
import { IngredientEffect } from '../../ingredients/entities/ingredient-effect.entity';

const PUBCHEM_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const DELAY_MS = 250; // 4 req/sec — safely within PubChem limits

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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPubChemSynonyms(query: string, byType: 'name' | 'cid' = 'name'): Promise<string[]> {
  try {
    const url = `${PUBCHEM_BASE}/compound/${byType}/${encodeURIComponent(query)}/synonyms/JSON`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data?.InformationList?.Information?.[0]?.Synonym ?? [];
  } catch {
    return [];
  }
}

function normaliseAlias(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

async function enrichWithPubChem() {
  await AppDataSource.initialize();
  const ingredientRepo = AppDataSource.getRepository(Ingredient);
  const aliasRepo = AppDataSource.getRepository(IngredientAlias);

  const ingredients = await ingredientRepo.find({ select: ['id', 'canonicalName', 'casNumber', 'inciNames'] });
  console.log(`🔬 Enriching ${ingredients.length} ingredients via PubChem...`);

  let enriched = 0;
  let aliasesAdded = 0;
  let failed = 0;

  for (let i = 0; i < ingredients.length; i++) {
    const ing = ingredients[i];
    const query = ing.casNumber || ing.inciNames?.[0] || ing.canonicalName;

    let synonyms: string[] = [];

    // Try CAS number first (most precise), fall back to name
    if (ing.casNumber) {
      synonyms = await fetchPubChemSynonyms(ing.casNumber, 'name');
      await sleep(DELAY_MS);
    }

    if (!synonyms.length && ing.inciNames?.[0]) {
      synonyms = await fetchPubChemSynonyms(ing.inciNames[0], 'name');
      await sleep(DELAY_MS);
    }

    if (!synonyms.length) {
      failed++;
      continue;
    }

    // Save unique synonyms as aliases
    for (const syn of synonyms.slice(0, 50)) { // cap at 50 synonyms per ingredient
      const aliasText = normaliseAlias(syn);
      if (!aliasText || aliasText.length > 200) continue;

      const exists = await aliasRepo.findOne({ where: { aliasText } });
      if (!exists) {
        await aliasRepo.save({ aliasText, aliasType: 'pubchem', ingredientId: ing.id });
        aliasesAdded++;
      }
    }

    enriched++;

    if ((i + 1) % 100 === 0) {
      console.log(`  ✅ ${i + 1}/${ingredients.length} processed — ${aliasesAdded} aliases added so far`);
    }
  }

  await AppDataSource.destroy();

  console.log('\n🎉 PubChem enrichment complete!');
  console.log(`   Ingredients enriched: ${enriched}`);
  console.log(`   Total aliases added:  ${aliasesAdded}`);
  console.log(`   No PubChem data:      ${failed}`);
}

enrichWithPubChem().catch(err => {
  console.error('Enrichment failed:', err);
  process.exit(1);
});
