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
};

@Injectable()
export class IngredientParserService {
  /**
   * Parse a raw ingredients string into a normalized token array.
   * Handles comma/period-separated INCI lists with parenthetical extras.
   */
  parse(rawIngredients: string): string[] {
    if (!rawIngredients?.trim()) return [];

    // "(and)" is an INCI separator used instead of a comma — treat it as a delimiter
    const normalizedSeparators = rawIngredients.replace(/\s*\(and\)\s*/gi, ',');

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
}
