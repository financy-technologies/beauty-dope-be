import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ingredient } from './entities/ingredient.entity';
import { IngredientAlias } from './entities/ingredient-alias.entity';

export interface ParsedIngredientToken {
  rawToken: string;           // original string from the ingredient list
  cleanName: string;          // after stripping %, punctuation
  canonicalName: string | null; // resolved canonical name, null = unknown
  ingredientId: string | null;
  explicitPercentage: number | null; // if the label had "Niacinamide 10%"
  position: number;           // 0-based position in the list
  concentrationTier: 'major' | 'mid' | 'trace' | 'unknown'; // inferred from position
  isUnknown: boolean;         // true = not in our DB, displayed as-is but doesn't break
}

// Known "below 1%" signal ingredients — their presence marks that all following
// ingredients are <1% concentration (EU Cosmetics Regulation 1223/2009)
const BELOW_ONE_PERCENT_SIGNALS = new Set([
  'phenoxyethanol', 'ethylhexylglycerin', 'caprylyl glycol',
  'sodium benzoate', 'potassium sorbate', 'chlorphenesin',
  'benzyl alcohol', 'dehydroacetic acid', 'sorbic acid',
  'methylisothiazolinone', 'methylchloroisothiazolinone',
  'ci 77891', 'ci 77492', 'ci 77491', 'ci 77499', // colorants
]);

// Normalise unicode and common OCR variants before alias lookup
function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics (é → e)
    .replace(/[®™©]/g, '')             // strip trademark symbols
    .replace(/\s*\/\s*/g, '/')         // "AQUA / WATER" → "AQUA/WATER"
    .replace(/[^a-z0-9\s\-\/\(\)\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class IngredientParserService {
  constructor(
    @InjectRepository(Ingredient)
    private ingredientRepo: Repository<Ingredient>,
    @InjectRepository(IngredientAlias)
    private aliasRepo: Repository<IngredientAlias>,
  ) {}

  /**
   * Main entry point — parse a raw INCI ingredient list string.
   * Never throws for unknown ingredients; marks them as isUnknown=true.
   */
  async parseIngredientList(raw: string): Promise<ParsedIngredientToken[]> {
    if (!raw?.trim()) return [];

    const tokens = this.splitIngredientList(raw);
    const results: ParsedIngredientToken[] = [];

    // Detect the "below 1%" threshold position
    let belowOnePercentStart = tokens.length; // default: no signal found
    for (let i = 0; i < tokens.length; i++) {
      const norm = normaliseText(this.stripPercentage(tokens[i]).cleanName);
      if (BELOW_ONE_PERCENT_SIGNALS.has(norm)) {
        belowOnePercentStart = i;
        break;
      }
    }

    for (let i = 0; i < tokens.length; i++) {
      const rawToken = tokens[i].trim();
      const { cleanName, percentage } = this.stripPercentage(rawToken);

      const resolved = await this.resolveIngredient(cleanName);

      const tier = this.inferConcentrationTier(i, tokens.length, belowOnePercentStart, percentage);

      results.push({
        rawToken,
        cleanName,
        canonicalName: resolved?.canonicalName ?? null,
        ingredientId: resolved?.id ?? null,
        explicitPercentage: percentage,
        position: i,
        concentrationTier: tier,
        isUnknown: resolved === null,
      });
    }

    return results;
  }

  /**
   * Split a raw ingredient string by comma, respecting parentheses.
   * e.g. "Water, Niacinamide (Vitamin B3), Glycerin" → 3 tokens
   */
  private splitIngredientList(raw: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let depth = 0;

    for (const ch of raw) {
      if (ch === '(') { depth++; current += ch; }
      else if (ch === ')') { depth--; current += ch; }
      else if (ch === ',' && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) tokens.push(trimmed);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) tokens.push(current.trim());

    return tokens;
  }

  /**
   * Extract explicit percentage from a token.
   * Handles: "Niacinamide 10%", "10% Niacinamide", "Niacinamide (10%)"
   */
  private stripPercentage(token: string): { cleanName: string; percentage: number | null } {
    const match = token.match(/(\d+(?:\.\d+)?)\s*%/);
    const percentage = match ? parseFloat(match[1]) : null;

    const cleanName = token
      .replace(/\(?\d+(?:\.\d+)?\s*%\)?/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return { cleanName, percentage };
  }

  /**
   * Resolve a cleaned ingredient name to a DB record.
   * Resolution order:
   *   1. Exact match on canonicalName
   *   2. Exact match on alias table (case-insensitive)
   *   3. Match inside parentheses (e.g. "Sodium Hyaluronate (Hyaluronic Acid)")
   *   4. Fuzzy Levenshtein match against aliases (distance ≤ 2, short words excluded)
   *   5. Returns null — caller marks as isUnknown
   */
  async resolveIngredient(name: string): Promise<Ingredient | null> {
    if (!name?.trim()) return null;

    const normalised = normaliseText(name);

    // 1. Exact canonical match
    const byCanonical = await this.ingredientRepo.findOne({
      where: { canonicalName: normalised.replace(/\s+/g, '-') },
    });
    if (byCanonical) return byCanonical;

    // 2. Alias lookup (exact, normalised)
    const byAlias = await this.aliasRepo.findOne({
      where: { aliasText: normalised },
      relations: ['ingredient'],
    });
    if (byAlias?.ingredient) return byAlias.ingredient;

    // 3. Extract text inside parentheses and try that too
    // "Sodium Hyaluronate (Hyaluronic Acid)" → also try "Hyaluronic Acid"
    const parenMatch = name.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const inner = normaliseText(parenMatch[1]);
      const byParenAlias = await this.aliasRepo.findOne({
        where: { aliasText: inner },
        relations: ['ingredient'],
      });
      if (byParenAlias?.ingredient) return byParenAlias.ingredient;

      const byParenCanonical = await this.ingredientRepo.findOne({
        where: { canonicalName: inner.replace(/\s+/g, '-') },
      });
      if (byParenCanonical) return byParenCanonical;
    }

    // 4. Fuzzy match — only for tokens longer than 5 chars to avoid false positives
    if (normalised.length > 5) {
      const candidate = await this.fuzzyAliasMatch(normalised);
      if (candidate) return candidate;
    }

    return null;
  }

  /**
   * Levenshtein-based fuzzy match against the alias table.
   * Only returns a match if distance ≤ 2.
   */
  private async fuzzyAliasMatch(normalised: string): Promise<Ingredient | null> {
    // Pull aliases that start with the same first 3 chars (reduces candidates)
    const prefix = normalised.slice(0, 3);
    const candidates = await this.aliasRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.ingredient', 'ing')
      .where('a.aliasText LIKE :prefix', { prefix: `${prefix}%` })
      .getMany();

    let best: IngredientAlias | null = null;
    let bestDist = 3; // threshold

    for (const c of candidates) {
      const dist = this.levenshtein(normalised, c.aliasText);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }

    return best?.ingredient ?? null;
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  /**
   * Infer concentration tier from position + EU regulation ordering rules.
   */
  private inferConcentrationTier(
    position: number,
    total: number,
    belowOneStart: number,
    explicitPct: number | null,
  ): 'major' | 'mid' | 'trace' | 'unknown' {
    if (explicitPct !== null) {
      if (explicitPct >= 10) return 'major';
      if (explicitPct >= 1) return 'mid';
      return 'trace';
    }

    if (position >= belowOneStart) return 'trace';
    if (position <= 2) return 'major';
    if (position <= 9) return 'mid';
    return 'unknown';
  }
}
