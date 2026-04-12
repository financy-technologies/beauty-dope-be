import { Injectable } from '@nestjs/common';

/**
 * INCI synonym map — maps common trade names / alternate spellings to their
 * canonical form so that Jaccard similarity compares the same thing.
 */
const SYNONYMS: Record<string, string> = {
  // Water
  'aqua': 'water',
  'eau': 'water',

  // Glycerin variants
  'glycerine': 'glycerin',
  'glycerol': 'glycerin',

  // Niacinamide
  'nicotinamide': 'niacinamide',
  'vitamin b3': 'niacinamide',
  'vit b3': 'niacinamide',

  // Vitamin C
  'ascorbic acid': 'vitamin-c',
  'l-ascorbic acid': 'vitamin-c',
  'ascorbyl glucoside': 'vitamin-c-derivative',
  'sodium ascorbyl phosphate': 'vitamin-c-derivative',
  'ascorbyl tetraisopalmitate': 'vitamin-c-derivative',
  'ethyl ascorbic acid': 'vitamin-c-derivative',
  '3-o-ethyl ascorbic acid': 'vitamin-c-derivative',

  // Retinol / Retinoids
  'retinol': 'retinol',
  'retinoic acid': 'retinol',
  'retinyl palmitate': 'retinol-derivative',
  'retinyl propionate': 'retinol-derivative',
  'retinaldehyde': 'retinaldehyde',
  'hydroxypinacolone retinoate': 'retinol-derivative',
  'granactive retinoid': 'retinol-derivative',

  // Hyaluronic acid
  'sodium hyaluronate': 'hyaluronic-acid',
  'hyaluronate': 'hyaluronic-acid',
  'ha': 'hyaluronic-acid',

  // AHAs
  'glycolic acid': 'glycolic-acid',
  'lactic acid': 'lactic-acid',
  'mandelic acid': 'mandelic-acid',
  'tartaric acid': 'tartaric-acid',
  'malic acid': 'malic-acid',

  // BHA
  'beta hydroxy acid': 'salicylic-acid',
  'bha': 'salicylic-acid',

  // Ceramides
  'ceramide np': 'ceramides',
  'ceramide ap': 'ceramides',
  'ceramide eop': 'ceramides',
  'ceramide ng': 'ceramides',
  'ceramide ag': 'ceramides',
  'ceramide 1': 'ceramides',
  'ceramide 2': 'ceramides',
  'ceramide 3': 'ceramides',

  // Peptides
  'palmitoyl tripeptide-1': 'peptides',
  'palmitoyl tetrapeptide-7': 'peptides',
  'acetyl hexapeptide-3': 'peptides',
  'acetyl hexapeptide-8': 'peptides',
  'copper peptide': 'peptides',
  'ghk-cu': 'peptides',

  // SPF filters
  'ethylhexyl methoxycinnamate': 'octinoxate',
  'octyl methoxycinnamate': 'octinoxate',
  'butyl methoxydibenzoylmethane': 'avobenzone',

  // Silicones
  'dimethicone': 'silicone',
  'cyclomethicone': 'silicone',
  'cyclopentasiloxane': 'silicone',
  'dimethiconol': 'silicone',

  // Alcohols
  'sd alcohol': 'alcohol-denat',
  'alcohol denat': 'alcohol-denat',
  'isopropyl alcohol': 'alcohol-denat',
  'cetyl alcohol': 'fatty-alcohol',
  'stearyl alcohol': 'fatty-alcohol',
  'cetearyl alcohol': 'fatty-alcohol',
  'behenyl alcohol': 'fatty-alcohol',

  // Botanical synonyms
  'aloe barbadensis leaf juice': 'aloe-vera',
  'aloe barbadensis leaf extract': 'aloe-vera',
  'aloe barbadensis': 'aloe-vera',
  'aloe vera gel': 'aloe-vera',
  'aloe vera': 'aloe-vera',
  'tocopheryl acetate': 'vitamin-e',
  'tocopherol': 'vitamin-e',
  'panthenol': 'panthenol',
  'dl-panthenol': 'panthenol',
  'pro-vitamin b5': 'panthenol',
};

// ─── Mechanism-of-Action Groups ───────────────────────────────────────────────
//
// Ingredients are grouped by the biological mechanism they trigger, not by
// chemical family. Two products can share NO ingredient tokens but still
// activate the same mechanisms (e.g. retinol and bakuchiol both drive
// collagen synthesis via different pathways). This is the engine behind
// mechanism-of-action similarity scoring.
//
export const MECHANISM_GROUPS: Record<string, string[]> = {
  'collagen-synthesis':   ['retinol', 'retinol-derivative', 'retinaldehyde', 'bakuchiol', 'peptides', 'vitamin-c', 'vitamin-c-derivative'],
  'brightening':          ['vitamin-c', 'vitamin-c-derivative', 'niacinamide', 'kojic acid', 'alpha-arbutin', 'arbutin', 'tranexamic acid', 'azelaic acid', 'mandelic-acid'],
  'deep-hydration':       ['hyaluronic-acid', 'glycerin', 'sodium-pca', 'betaine', 'trehalose', 'urea'],
  'barrier-repair':       ['ceramides', 'fatty-alcohol', 'cholesterol', 'phytosphingosine', 'squalane', 'shea butter'],
  'cell-turnover':        ['retinol', 'retinol-derivative', 'retinaldehyde', 'glycolic-acid', 'lactic-acid', 'mandelic-acid', 'salicylic-acid'],
  'anti-inflammatory':    ['centella asiatica', 'allantoin', 'panthenol', 'bisabolol', 'madecassoside', 'beta-glucan', 'aloe-vera'],
  'pore-clarity':         ['salicylic-acid', 'niacinamide', 'glycolic-acid', 'zinc', 'zinc pca', 'tea tree'],
  'uv-protection':        ['zinc-oxide', 'titanium-dioxide', 'avobenzone', 'octinoxate', 'tinosorb s', 'tinosorb m', 'bisoctrizole', 'bemotrizinol'],
  'antioxidant-defense':  ['vitamin-c', 'vitamin-c-derivative', 'vitamin-e', 'resveratrol', 'ferulic acid', 'green tea extract', 'astaxanthin'],
  'scalp-health':         ['zinc pyrithione', 'salicylic-acid', 'tea tree', 'piroctone olamine', 'selenium sulfide'],
};

// ─── Primary Skin Concern Signals ────────────────────────────────────────────
//
// Used to infer the PRIMARY skin concern a product addresses. If two products
// in the same subcategory target completely different concerns (e.g. brightening
// serum vs. acne serum), they should not be paired as dupes.
//
export const CONCERN_SIGNALS: Record<string, string[]> = {
  'brightening':  ['vitamin-c', 'vitamin-c-derivative', 'niacinamide', 'kojic acid', 'alpha-arbutin', 'arbutin', 'tranexamic acid'],
  'anti-aging':   ['retinol', 'retinol-derivative', 'retinaldehyde', 'bakuchiol', 'peptides'],
  'hydration':    ['hyaluronic-acid', 'ceramides', 'glycerin', 'squalane'],
  'acne':         ['salicylic-acid', 'benzoyl peroxide', 'azelaic acid', 'tea tree', 'zinc pca'],
  'barrier':      ['ceramides', 'fatty-alcohol', 'cholesterol', 'centella asiatica', 'madecassoside'],
  'spf':          ['zinc-oxide', 'titanium-dioxide', 'avobenzone', 'octinoxate', 'tinosorb s', 'tinosorb m'],
};

// Concern compatibility: if concerns are "incompatible", the pair is penalized.
// Matrix is symmetric. Missing entries = 1.0 (no penalty).
const CONCERN_COMPATIBILITY: Record<string, Record<string, number>> = {
  'brightening': { 'acne': 0.85, 'spf': 0.6,  'barrier': 0.85, 'hydration': 0.9, 'anti-aging': 0.9  },
  'anti-aging':  { 'acne': 0.75, 'spf': 0.6,  'barrier': 0.9,  'hydration': 0.9, 'brightening': 0.9 },
  'acne':        { 'brightening': 0.85, 'anti-aging': 0.75, 'hydration': 0.9, 'barrier': 0.9 },
  'hydration':   { 'spf': 0.65 },
  'spf':         { 'brightening': 0.6, 'anti-aging': 0.6, 'hydration': 0.65, 'acne': 0.65, 'barrier': 0.65 },
};

// ─── Critical Actives (hard-match requirements) ───────────────────────────────
//
// When an original product contains a CRITICAL active, the dupe MUST contain
// it (or a functional equivalent in the same mechanism group) or a penalty is
// applied. These are the ingredients that DEFINE what a product does.
//
export const CRITICAL_ACTIVES_BY_SUBCATEGORY: Record<string, string[]> = {
  serum:        ['retinol', 'retinol-derivative', 'retinaldehyde', 'bakuchiol',
                 'vitamin-c', 'vitamin-c-derivative',
                 'glycolic-acid', 'lactic-acid', 'salicylic-acid',
                 'niacinamide', 'peptides', 'azelaic acid'],
  sunscreen:    ['zinc-oxide', 'titanium-dioxide', 'avobenzone', 'octinoxate',
                 'tinosorb s', 'tinosorb m', 'bisoctrizole', 'bemotrizinol'],
  'anti-aging': ['retinol', 'retinol-derivative', 'retinaldehyde', 'bakuchiol', 'peptides'],
  cleanser:     ['salicylic-acid', 'glycolic-acid', 'niacinamide', 'benzoyl peroxide'],
  toner:        ['glycolic-acid', 'lactic-acid', 'salicylic-acid', 'niacinamide'],
  'eye-cream':  ['retinol', 'retinol-derivative', 'caffeine', 'peptides'],
  exfoliator:   ['glycolic-acid', 'lactic-acid', 'salicylic-acid', 'mandelic-acid', 'pha', 'gluconolactone'],
  // moisturiser / mask / body products: no single critical active — omit means no penalty
  moisturiser:  [],
  moisturizer:  [],
  mask:         [],
  'body-lotion':[], 'body-wash': [], 'hair-mask': [], shampoo: [], conditioner: [],
};

/**
 * Key actives per subcategory — ingredients that define the product's
 * efficacy and count extra toward similarity.
 */
export const KEY_ACTIVES_BY_SUBCATEGORY: Record<string, string[]> = {
  serum: [
    'retinol', 'retinol-derivative', 'retinaldehyde',
    'niacinamide',
    'vitamin-c', 'vitamin-c-derivative',
    'hyaluronic-acid',
    'glycolic-acid', 'lactic-acid', 'salicylic-acid', 'mandelic-acid',
    'azelaic acid',
    'bakuchiol',
    'peptides',
    'ceramides',
  ],
  moisturiser: [
    'hyaluronic-acid', 'glycerin', 'ceramides', 'niacinamide',
    'peptides', 'retinol', 'retinol-derivative', 'vitamin-c-derivative',
    'squalane', 'shea butter', 'centella asiatica',
  ],
  moisturizer: [
    'hyaluronic-acid', 'glycerin', 'ceramides', 'niacinamide',
    'peptides', 'retinol', 'retinol-derivative', 'vitamin-c-derivative',
    'squalane', 'shea butter', 'centella asiatica',
  ],
  cleanser: [
    'salicylic-acid', 'glycolic-acid', 'niacinamide', 'benzoyl peroxide',
    'tea tree', 'centella asiatica', 'hyaluronic-acid',
  ],
  toner: [
    'niacinamide', 'glycolic-acid', 'lactic-acid', 'hyaluronic-acid',
    'salicylic-acid', 'centella asiatica', 'witch hazel',
  ],
  sunscreen: [
    'zinc-oxide', 'titanium-dioxide', 'avobenzone', 'octinoxate',
    'tinosorb s', 'tinosorb m', 'uvinul a plus',
    'bisoctrizole', 'bemotrizinol',
  ],
  'eye-cream': [
    'retinol', 'retinol-derivative', 'peptides', 'caffeine',
    'hyaluronic-acid', 'ceramides', 'vitamin-c-derivative',
  ],
  mask: [
    'kaolin', 'bentonite', 'salicylic-acid', 'glycolic-acid',
    'hyaluronic-acid', 'niacinamide', 'centella asiatica',
  ],
  exfoliator: [
    'glycolic-acid', 'lactic-acid', 'salicylic-acid', 'mandelic-acid',
    'pha', 'gluconolactone',
  ],
  foundation: ['spf', 'hyaluronic-acid', 'niacinamide', 'titanium-dioxide', 'zinc-oxide'],
  concealer: ['hyaluronic-acid', 'vitamin-e', 'peptides'],
  shampoo: ['keratin', 'biotin', 'panthenol', 'niacinamide', 'salicylic-acid', 'zinc pyrithione'],
  conditioner: ['keratin', 'panthenol', 'ceramides', 'argan oil', 'shea butter'],
  'hair-mask': ['keratin', 'panthenol', 'argan oil', 'shea butter', 'ceramides'],
  'hair-oil': ['argan oil', 'jojoba oil', 'rosehip oil', 'castor oil', 'bhringraj'],
  'body-lotion': ['hyaluronic-acid', 'ceramides', 'glycerin', 'shea butter', 'niacinamide'],
  'body-wash': ['salicylic-acid', 'niacinamide', 'glycerin', 'shea butter'],
  'anti-aging': [
    'retinol', 'retinol-derivative', 'retinaldehyde',
    'niacinamide', 'peptides', 'ceramides',
    'vitamin-c', 'vitamin-c-derivative',
    'hyaluronic-acid', 'glycolic-acid', 'lactic-acid',
    'squalane', 'bakuchiol',
  ],
  'night-cream': [
    'retinol', 'retinol-derivative', 'peptides', 'ceramides',
    'niacinamide', 'hyaluronic-acid', 'squalane',
  ],
};

@Injectable()
export class IngredientParserService {
  /**
   * Parse a raw ingredients string into a normalized token array.
   * Handles comma/period-separated INCI lists with parenthetical extras.
   */
  parse(rawIngredients: string): string[] {
    if (!rawIngredients?.trim()) return [];

    // Strip common prefix labels before the actual ingredient list
    // e.g. "Key Ingredients: Retinol, ..." or "Ingredients: Aqua, ..."
    let cleaned = rawIngredients.replace(
      /^[\s\S]*?(key\s+ingredients?|active\s+ingredients?|ingredients?|contains?|inci)\s*[:\-]\s*/i,
      '',
    );

    // "(and)" is an INCI separator used instead of a comma — treat it as a delimiter
    const normalizedSeparators = cleaned.replace(/\s*\(and\)\s*/gi, ',');

    return normalizedSeparators
      .split(/,|;/)                           // split on comma or semicolon
      .map((token) => this.normalize(token))  // normalize each
      .filter(Boolean)                        // remove empty
      .filter((v, i, arr) => arr.indexOf(v) === i); // deduplicate
  }

  /**
   * Normalize a single ingredient token:
   * - lowercase, trim
   * - strip parenthetical suffixes like "(and)" or "(CI 12345)"
   * - strip trailing asterisks / numbers
   * - resolve synonyms
   */
  normalize(raw: string): string {
    let s = raw.toLowerCase().trim();

    // Remove parenthetical groups: "(ci 12345)" or "(and)" etc.
    s = s.replace(/\([^)]*\)/g, '').trim();

    // Remove trailing asterisk, numbers, slashes used for notes
    s = s.replace(/[*†‡°\/\\]+$/g, '').trim();

    // Collapse internal whitespace
    s = s.replace(/\s+/g, ' ');

    // Resolve synonym
    return SYNONYMS[s] ?? s;
  }

  /**
   * Returns the key actives present in a token array for a given subcategory.
   */
  extractKeyActives(tokens: string[], subcategory: string): Set<string> {
    const actives = KEY_ACTIVES_BY_SUBCATEGORY[subcategory.toLowerCase()] ?? [];
    const activeSet = new Set(actives);
    return new Set(tokens.filter((t) => activeSet.has(t)));
  }

  /**
   * Jaccard similarity between two sets.
   */
  jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;

    let intersectionSize = 0;
    for (const item of a) {
      if (b.has(item)) intersectionSize++;
    }

    const unionSize = a.size + b.size - intersectionSize;
    return intersectionSize / unionSize;
  }

  /**
   * Active-ingredient overlap ratio for a subcategory.
   * Returns what fraction of the expected key actives are shared.
   * (Used by v2 engine — kept for backward compatibility.)
   */
  activeOverlap(
    tokensA: string[],
    tokensB: string[],
    subcategory: string,
  ): number {
    const actives = KEY_ACTIVES_BY_SUBCATEGORY[subcategory.toLowerCase()];
    if (!actives?.length) return 0;

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);

    const sharedActives = actives.filter((a) => setA.has(a) && setB.has(a));
    const presentInEither = actives.filter((a) => setA.has(a) || setB.has(a));

    return presentInEither.length ? sharedActives.length / presentInEither.length : 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // v3 Scoring Primitives
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Position-weighted Jaccard similarity.
   *
   * INCI ingredient lists are ordered by concentration (highest first).
   * Ingredients at the top of the list make up the bulk of the formula.
   * This weights shared ingredients by their average position in both lists,
   * using harmonic decay: w(i) = 1 / (1 + 0.3 * i).
   *
   * Two products sharing niacinamide at position 3 score much higher than
   * two products sharing it buried at position 28.
   */
  positionWeightedJaccard(tokensA: string[], tokensB: string[]): number {
    if (!tokensA.length || !tokensB.length) return 0;

    const weight = (i: number) => 1 / (1 + 0.3 * i);

    // Build position-indexed weight maps
    const weightA = new Map<string, number>();
    const weightB = new Map<string, number>();
    tokensA.forEach((t, i) => weightA.set(t, weight(i)));
    tokensB.forEach((t, i) => weightB.set(t, weight(i)));

    const allTokens = new Set([...tokensA, ...tokensB]);

    let intersection = 0;
    let union = 0;

    for (const token of allTokens) {
      const wA = weightA.get(token) ?? 0;
      const wB = weightB.get(token) ?? 0;
      // Shared: take the minimum weight (conservative — both must place it highly)
      intersection += Math.min(wA, wB);
      // Union: take the maximum weight
      union += Math.max(wA, wB);
    }

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Returns the set of mechanism-of-action groups activated by a token list.
   * An ingredient activates a mechanism if it appears in MECHANISM_GROUPS[mechanism].
   */
  getMechanismsActivated(tokens: string[]): Set<string> {
    const tokenSet = new Set(tokens);
    const mechanisms = new Set<string>();

    for (const [mechanism, ingredients] of Object.entries(MECHANISM_GROUPS)) {
      if (ingredients.some((ing) => tokenSet.has(ing))) {
        mechanisms.add(mechanism);
      }
    }
    return mechanisms;
  }

  /**
   * Mechanism-of-action similarity between two products.
   *
   * Scores overlap of the biological mechanisms both products activate.
   * This is a Jaccard over mechanism sets, BUT weighted by how strongly
   * each mechanism is represented (number of actives from that group present).
   */
  mechanismSimilarity(tokensA: string[], tokensB: string[]): number {
    const mechanismStrength = (tokens: string[], mechanism: string): number => {
      const ingredients = MECHANISM_GROUPS[mechanism] ?? [];
      const tokenSet = new Set(tokens);
      const hits = ingredients.filter((i) => tokenSet.has(i)).length;
      return Math.min(hits / Math.max(ingredients.length * 0.3, 1), 1); // normalize
    };

    const allMechanisms = Object.keys(MECHANISM_GROUPS);
    let weightedIntersection = 0;
    let weightedUnion = 0;

    for (const mech of allMechanisms) {
      const sA = mechanismStrength(tokensA, mech);
      const sB = mechanismStrength(tokensB, mech);
      if (sA === 0 && sB === 0) continue;
      weightedIntersection += Math.min(sA, sB);
      weightedUnion        += Math.max(sA, sB);
    }

    return weightedUnion > 0 ? weightedIntersection / weightedUnion : 0;
  }

  /**
   * Recall-based active overlap (v3 replacement for activeOverlap).
   *
   * Asks: "What fraction of the ORIGINAL's key actives does the DUPE replicate?"
   * This is directional (recall), not symmetric — it penalises a dupe for
   * missing actives that are in the original, but does NOT penalise the dupe
   * for having EXTRA actives.
   *
   * Two levels of match:
   *   1. Exact token match (full credit)
   *   2. Same mechanism group match (partial credit = 0.7) — covers cases where
   *      bakuchiol is present in dupe as a retinol equivalent.
   */
  activeRecallScore(
    tokensOriginal: string[],
    tokensDupe: string[],
    subcategory: string,
  ): number {
    const actives = KEY_ACTIVES_BY_SUBCATEGORY[subcategory.toLowerCase()];
    if (!actives?.length) return 0;

    const originalSet = new Set(tokensOriginal);
    const dupeSet     = new Set(tokensDupe);

    // Actives present in original (these define what we need to replicate)
    const originalActives = actives.filter((a) => originalSet.has(a));
    if (!originalActives.length) return 0;

    let score = 0;
    for (const active of originalActives) {
      if (dupeSet.has(active)) {
        score += 1.0; // exact match
      } else {
        // Check if dupe has a functional equivalent in the same mechanism group
        const mechGroup = Object.values(MECHANISM_GROUPS).find((group) => group.includes(active));
        if (mechGroup) {
          const hasFunctionalEquiv = mechGroup.some((equiv) => equiv !== active && dupeSet.has(equiv));
          if (hasFunctionalEquiv) score += 0.7; // partial credit for functional equivalent
        }
      }
    }

    return score / originalActives.length;
  }

  /**
   * Penalty for missing critical actives.
   *
   * Critical actives are the ONE ingredient that DEFINES what a product does
   * (e.g. retinol in an anti-aging serum, SPF filters in a sunscreen).
   * If the original has a critical active and the dupe has NO equivalent
   * (not even in the same mechanism group), a penalty is applied.
   *
   * Returns a value in [0, 0.20] to subtract from the composite score.
   */
  missingCriticalActivePenalty(
    tokensOriginal: string[],
    tokensDupe: string[],
    subcategory: string,
  ): number {
    const criticals = CRITICAL_ACTIVES_BY_SUBCATEGORY[subcategory.toLowerCase()] ?? [];
    if (!criticals.length) return 0;

    const originalSet = new Set(tokensOriginal);
    const dupeSet     = new Set(tokensDupe);

    const originalCriticals = criticals.filter((c) => originalSet.has(c));
    if (!originalCriticals.length) return 0;

    let missingCount = 0;
    for (const critical of originalCriticals) {
      if (dupeSet.has(critical)) continue;

      // Check for functional equivalent in the same mechanism group
      const mechGroup = Object.values(MECHANISM_GROUPS).find((g) => g.includes(critical));
      const hasFunctionalEquiv = mechGroup?.some((equiv) => equiv !== critical && dupeSet.has(equiv));
      if (!hasFunctionalEquiv) missingCount++;
    }

    return (missingCount / originalCriticals.length) * 0.20;
  }

  /**
   * Price efficiency score — bell curve centered at 2–4× price ratio.
   *
   * The "sweet spot" for a real dupe is 50–75% savings (2–4× cheaper).
   * Barely cheaper products (< 1.3×) don't qualify. Extremely cheap products
   * (> 7×) raise quality concerns.
   *
   * Returns [0, 1].
   */
  priceEfficiencyScore(priceRatio: number): number {
    if (priceRatio < 1.2) return 0.0;
    if (priceRatio < 1.5) return 0.3;
    if (priceRatio < 2.0) return 0.65;
    if (priceRatio <= 4.0) return 1.0;   // sweet spot
    if (priceRatio <= 5.5) return 0.75;
    if (priceRatio <= 7.0) return 0.5;
    return 0.3;                           // > 7× — unlikely to be same quality tier
  }

  /**
   * Safety profile match score.
   *
   * Bonus when both products agree on safety flags (fungalAcneSafe,
   * pregnancySafe). Mismatch penalises — a dupe that changes your safety
   * profile is not a true dupe.
   *
   * Returns [0, 1]. Defaults to 0.5 when data is unavailable.
   */
  safetyProfileScore(
    fungalSafeA: boolean | undefined,
    fungalSafeB: boolean | undefined,
    pregnancySafeA: boolean | undefined,
    pregnancySafeB: boolean | undefined,
  ): number {
    let score = 0;
    let checks = 0;

    if (fungalSafeA !== undefined && fungalSafeB !== undefined) {
      score += fungalSafeA === fungalSafeB ? 1 : 0;
      checks++;
    }
    if (pregnancySafeA !== undefined && pregnancySafeB !== undefined) {
      score += pregnancySafeA === pregnancySafeB ? 1 : 0;
      checks++;
    }

    return checks > 0 ? score / checks : 0.5; // 0.5 = neutral when no data
  }

  /**
   * Infer the primary skin concern from a token list for a given subcategory.
   * Returns the concern with the most matching signal ingredients, or null if
   * none detected.
   */
  detectPrimaryConcern(tokens: string[], subcategory: string): string | null {
    // For sunscreens, the concern is always SPF
    if (subcategory === 'sunscreen') return 'spf';

    const tokenSet = new Set(tokens);
    let bestConcern: string | null = null;
    let bestScore = 0;

    for (const [concern, signals] of Object.entries(CONCERN_SIGNALS)) {
      const matchCount = signals.filter((s) => tokenSet.has(s)).length;
      if (matchCount > bestScore) {
        bestScore   = matchCount;
        bestConcern = concern;
      }
    }

    return bestScore >= 1 ? bestConcern : null;
  }

  /**
   * Returns the compatibility multiplier for two skin concerns.
   * 1.0 = same concern or no concern detected (no restriction).
   * < 1.0 = different concerns (apply as score multiplier).
   */
  concernCompatibility(concernA: string | null, concernB: string | null): number {
    if (!concernA || !concernB) return 1.0;  // unknown → no penalty
    if (concernA === concernB) return 1.0;

    return CONCERN_COMPATIBILITY[concernA]?.[concernB]
      ?? CONCERN_COMPATIBILITY[concernB]?.[concernA]
      ?? 0.9; // default: mild penalty for different concerns
  }
}
