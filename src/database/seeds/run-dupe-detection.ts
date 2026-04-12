/**
 * Standalone Dupe Detection Script
 *
 * Bootstraps the NestJS DI context, runs the full v3 dupe detection engine,
 * and persists all results to the configured database.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   DB_HOST=localhost DB_PORT=3306 DB_USERNAME=root \
 *   DB_PASSWORD=<pass> DB_NAME=beautydope \
 *     npm run run:dupes
 *
 * ── What it does ───────────────────────────────────────────────────────────
 *   1. Loads all products from DB that have ≥ 8 ingredient tokens
 *   2. Groups by subcategory
 *   3. For every (original, dupe) pair within each subcategory, runs the
 *      v3 7-component composite scorer:
 *        - Active recall (35%)
 *        - Position-weighted Jaccard (25%)
 *        - Mechanism-of-action similarity (20%)
 *        - Price efficiency (10%)
 *        - Safety profile match (5%)
 *        - Form factor (5%)
 *        - − Critical active penalty (0–20%)
 *        - × Concern compatibility multiplier
 *   4. Upserts all pairs scoring ≥ 0.52 into the dupes table
 *   5. Prints a breakdown by subcategory + final summary
 */

import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { DupeEngineService } from '../../dupes/dupe-engine.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const c    = (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`;
const green  = (s: string) => c(32, s);
const red    = (s: string) => c(31, s);
const cyan   = (s: string) => c(36, s);
const bold   = (s: string) => c(1,  s);
const dim    = (s: string) => c(2,  s);

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(bold('\n╔══════════════════════════════════════════════╗'));
  console.log(bold('║     Skin Signal Dupe Engine v3  →  DB        ║'));
  console.log(bold('╚══════════════════════════════════════════════╝'));
  console.log(`  DB : ${cyan(`${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? '3306'}/${process.env.DB_NAME ?? 'beautydope'}`)}\n`);

  process.stdout.write('  Booting NestJS application context … ');

  // createApplicationContext boots the full DI container without starting HTTP
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'], // suppress NestJS startup noise
  });

  console.log(green('ready'));

  const engine = app.get(DupeEngineService);

  console.log(dim('  Running full detection (this may take several minutes on large datasets)…\n'));

  const t0 = Date.now();

  const { created, updated } = await engine.runFullDetection();

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);

  console.log(bold('\n╔══════════════════════════════════════════════╗'));
  console.log(bold('║                 FINAL SUMMARY                ║'));
  console.log(bold('╚══════════════════════════════════════════════╝'));
  console.log(`  ${green('New dupes created')} : ${created.toLocaleString()}`);
  console.log(`  ${dim('Existing updated')}  : ${updated.toLocaleString()}`);
  console.log(`  Total processed   : ${(created + updated).toLocaleString()}`);
  console.log(`  Time elapsed      : ${elapsed} min\n`);

  if (created === 0 && updated === 0) {
    console.log(dim('  No dupes found. Possible reasons:'));
    console.log(dim('    • Products table is empty or has < 8 ingredient tokens per product'));
    console.log(dim('    • Run the scraper first: npm run scrape:nykaa:bulk'));
    console.log(dim('    • Check DB connection env vars (DB_HOST, DB_USERNAME, DB_PASSWORD, DB_NAME)'));
  }

  await app.close();
}

main().catch((err) => {
  console.error(red('\nFatal:'), err);
  process.exit(1);
});
