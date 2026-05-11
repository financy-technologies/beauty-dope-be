import { Injectable, NotFoundException, BadGatewayException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindManyOptions, IsNull, Brackets } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Product } from '../products/entities/product.entity';
import { Dupe } from '../dupes/entities/dupe.entity';
import { Review } from '../reviews/entities/review.entity';
import { Ingredient } from '../ingredients/entities/ingredient.entity';
import * as bcrypt from 'bcrypt';
import axios from 'axios';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)    private usersRepo: Repository<User>,
    @InjectRepository(Product) private productsRepo: Repository<Product>,
    @InjectRepository(Dupe)    private dupesRepo: Repository<Dupe>,
    @InjectRepository(Review)  private reviewsRepo: Repository<Review>,
    @InjectRepository(Ingredient) private ingredientRepo: Repository<Ingredient>,
  ) {}

  // ─── Stats ────────────────────────────────────────────────────
  async getStats() {
    const [users, products, dupes, reviews] = await Promise.all([
      this.usersRepo.count(),
      this.productsRepo.count(),
      this.dupesRepo.count(),
      this.reviewsRepo.count(),
    ]);
    return { users, products, dupes, reviews };
  }

  async generateAffiliateLink(url: string, clientIp?: string) {
    if (!url?.trim()) {
      throw new BadRequestException('URL is required');
    }

    const apiKey = 'GVvoz2xAQJ5nJwY648KSd6RYpd19AUto87v7Q7Tm';
    const userId = 5074225;
    const ipAddress = clientIp || '10.0.0.41';

    const payload = {
      data: {
        type: 'createexternalearnlink',
        attributes: {
          userid: userId,
          links: [url.trim()],
          ip_address: ipAddress,
        },
      },
    };

    try {
      const response = await axios.post(
        'https://middleware.ckaro.in/api/convert/ekaro',
        payload,
        {
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 15000,
        },
      );

      const result = response.data?.data?.[0];
      const affiliateUrl = result?.ekaro_url;

      if (!affiliateUrl) {
        throw new BadGatewayException('Affiliate link service returned an unexpected response');
      }

      return {
        originalUrl: result.original_url ?? url.trim(),
        affiliateUrl,
      };
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      const message = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : 'Failed to generate affiliate link';
      throw new BadGatewayException(message);
    }
  }

  // ─── Users ────────────────────────────────────────────────────
  async listUsers(page = 1, limit = 20, search = '') {
    const where = search ? [{ email: Like(`%${search}%`) }, { displayName: Like(`%${search}%`) }] : {};
    const [data, total] = await this.usersRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      select: ['id', 'email', 'displayName', 'isAdmin', 'createdAt', 'updatedAt'],
    });
    return { data, total, page, limit };
  }

  async getUser(id: string) {
    const user = await this.usersRepo.findOne({ where: { id }, select: ['id', 'email', 'displayName', 'isAdmin', 'createdAt', 'updatedAt'] });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateUser(id: string, dto: { email?: string; displayName?: string; isAdmin?: boolean; password?: string }) {
    await this.getUser(id);
    const update: any = {};
    if (dto.email !== undefined) update.email = dto.email;
    if (dto.displayName !== undefined) update.displayName = dto.displayName;
    if (dto.isAdmin !== undefined) update.isAdmin = dto.isAdmin;
    if (dto.password) update.password = await bcrypt.hash(dto.password, 10);
    await this.usersRepo.update(id, update);
    return this.getUser(id);
  }

  async deleteUser(id: string) {
    await this.getUser(id);
    await this.usersRepo.delete(id);
  }

  async createUser(dto: { email: string; password: string; displayName?: string; isAdmin?: boolean }) {
    const hashed = await bcrypt.hash(dto.password, 10);
    const user = this.usersRepo.create({ email: dto.email, password: hashed, displayName: dto.displayName, isAdmin: dto.isAdmin ?? false });
    await this.usersRepo.save(user);
    return this.getUser(user.id);
  }

  // ─── Products ─────────────────────────────────────────────────
  async listProducts(page = 1, limit = 20, search = '') {
    const where: any = search ? [{ name: Like(`%${search}%`) }, { brand: Like(`%${search}%`) }] : {};
    const [data, total] = await this.productsRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async getProduct(id: string) {
    const p = await this.productsRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async createProduct(dto: Partial<Product>) {
    const p = this.productsRepo.create(dto);
    return this.productsRepo.save(p);
  }

  async updateProduct(id: string, dto: Partial<Product>) {
    await this.getProduct(id);
    await this.productsRepo.update(id, dto as any);
    return this.getProduct(id);
  }

  async deleteProduct(id: string) {
    await this.getProduct(id);
    await this.productsRepo.delete(id);
  }

  async listFlaggedProducts(page = 1, limit = 20) {
    const [data, total] = await this.productsRepo.findAndCount({
      where: { flaggedReason: Like('%') } as any,
      order: { flaggedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async clearFlag(id: string) {
    await this.getProduct(id);
    await this.productsRepo.update(id, { flaggedReason: null, flagNote: null, flaggedAt: null } as any);
    return this.getProduct(id);
  }

  // ─── Unparsed Ingredients ──────────────────────────────────────
  async listUnparsedIngredients(page = 1, limit = 20, filter: 'all' | 'empty' | 'no_tokens' | 'partial' = 'all') {
    const qb = this.productsRepo.createQueryBuilder('p');

    if (filter === 'empty') {
      qb.where('(p.ingredients IS NULL OR p.ingredients = :empty)', { empty: '' });
    } else if (filter === 'no_tokens') {
      qb.where('p.ingredients IS NOT NULL')
        .andWhere('p.ingredients != :empty', { empty: '' })
        .andWhere('(p.ingredients_tokens IS NULL OR p.ingredient_breakdown IS NULL)');
    } else if (filter === 'partial') {
      qb.where('p.ingredient_breakdown IS NOT NULL')
        .andWhere('JSON_EXTRACT(p.ingredient_breakdown, "$.recognizedCount") < JSON_EXTRACT(p.ingredient_breakdown, "$.tokenCount")');
    } else {
      qb.where(new Brackets(sub => {
        sub.where('p.ingredients IS NULL')
          .orWhere('p.ingredients = :empty', { empty: '' })
          .orWhere('p.ingredients_tokens IS NULL')
          .orWhere('p.ingredient_breakdown IS NULL')
          .orWhere('JSON_EXTRACT(p.ingredient_breakdown, "$.recognizedCount") < JSON_EXTRACT(p.ingredient_breakdown, "$.tokenCount")');
      }));
    }

    const total = await qb.getCount();
    const data = await qb
      .orderBy('p.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const mapped = data.map(p => {
      let issue = 'unknown';
      if (!p.ingredients || p.ingredients.trim() === '') {
        issue = 'empty';
      } else if (!p.ingredientsTokens) {
        issue = 'no_tokens';
      } else if (!p.ingredientBreakdown) {
        issue = 'no_breakdown';
      } else if (p.ingredientBreakdown.recognizedCount < p.ingredientBreakdown.tokenCount) {
        issue = 'partial';
      }
      return {
        ...p,
        ingredientIssue: issue,
        tokenCount: p.ingredientBreakdown?.tokenCount ?? (p.ingredientsTokens?.length ?? 0),
        recognizedCount: p.ingredientBreakdown?.recognizedCount ?? 0,
      };
    });

    return { data: mapped, total, page, limit };
  }

  // ─── Dupes ────────────────────────────────────────────────────
  async listDupes(page = 1, limit = 20) {
    const [data, total] = await this.dupesRepo.findAndCount({
      relations: ['originalProduct', 'dupeProduct'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data: data.map(this.mapDupe), total, page, limit };
  }

  async getDupe(id: string) {
    const d = await this.dupesRepo.findOne({ where: { id }, relations: ['originalProduct', 'dupeProduct'] });
    if (!d) throw new NotFoundException('Dupe not found');
    return this.mapDupe(d);
  }

  async updateDupe(id: string, dto: {
    similarityScore?: number; savingsPercent?: number; category?: string;
    isFeatured?: boolean; isTrending?: boolean; dupeLabel?: string;
    dupeRank?: number; scoreConfidence?: number;
  }) {
    await this.getDupe(id);
    await this.dupesRepo.update(id, dto as any);
    return this.getDupe(id);
  }

  async deleteDupe(id: string) {
    await this.getDupe(id);
    await this.dupesRepo.delete(id);
  }

  async createDupe(dto: { originalProductId: string; dupeProductId: string; similarityScore: number; savingsPercent: number; category: string; isFeatured?: boolean; isTrending?: boolean; dupeLabel?: string }) {
    const original = await this.getProduct(dto.originalProductId);
    const dupe = await this.getProduct(dto.dupeProductId);
    const d = this.dupesRepo.create({
      originalProduct: original,
      dupeProduct: dupe,
      similarityScore: dto.similarityScore,
      savingsPercent: dto.savingsPercent,
      category: dto.category,
      isFeatured: dto.isFeatured ?? false,
      isTrending: dto.isTrending ?? false,
      dupeLabel: dto.dupeLabel,
    });
    await this.dupesRepo.save(d);
    return this.getDupe(d.id);
  }

  // ─── Reviews ──────────────────────────────────────────────────
  async listReviews(page = 1, limit = 20) {
    const [data, total] = await this.reviewsRepo.findAndCount({
      relations: ['user', 'dupe'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: data.map(r => ({
        id: r.id, rating: r.rating, comment: r.comment, createdAt: r.createdAt,
        user: { id: r.user?.id, email: r.user?.email, displayName: r.user?.displayName },
        dupeId: r.dupe?.id,
      })),
      total, page, limit,
    };
  }

  async updateReview(id: string, dto: { rating?: number; comment?: string }) {
    const r = await this.reviewsRepo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Review not found');
    await this.reviewsRepo.update(id, dto);
    return this.reviewsRepo.findOne({ where: { id }, relations: ['user', 'dupe'] });
  }

  async deleteReview(id: string) {
    const r = await this.reviewsRepo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Review not found');
    await this.reviewsRepo.delete(id);
  }

  private mapDupe(d: Dupe) {
    return {
      id: d.id, similarityScore: d.similarityScore, savingsPercent: d.savingsPercent,
      category: d.category, isFeatured: d.isFeatured, isTrending: d.isTrending,
      dupeLabel: d.dupeLabel, dupeRank: d.dupeRank, scoreConfidence: d.scoreConfidence,
      totalVotes: d.totalVotes, avgRating: Number(d.avgRating),
      createdAt: d.createdAt,
      original: d.originalProduct ? { id: d.originalProduct.id, name: d.originalProduct.name, brand: d.originalProduct.brand, price: Number(d.originalProduct.price) } : null,
      dupe: d.dupeProduct ? { id: d.dupeProduct.id, name: d.dupeProduct.name, brand: d.dupeProduct.brand, price: Number(d.dupeProduct.price) } : null,
    };
  }

  // ─── Ingredient Fixing (Phase 1-3) ─────────────────────────────

  /**
   * Fuzzy string similarity scoring (0-100)
   * Using Levenshtein distance
   */
  private fuzzyScore(a: string, b: string): number {
    const aLower = a.toLowerCase().trim();
    const bLower = b.toLowerCase().trim();
    if (aLower === bLower) return 100;

    const longer = aLower.length > bLower.length ? aLower : bLower;
    const shorter = aLower.length > bLower.length ? bLower : aLower;

    if (longer.length === 0) return 100;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return Math.round(((longer.length - editDistance) / longer.length) * 100);
  }

  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost,
        );
      }
    }
    return dp[m][n];
  }

  /**
   * Phase 1: Fuzzy match ingredients
   */
  async fuzzyMatchIngredient(query: string, threshold = 70) {
    if (!query?.trim()) {
      throw new BadRequestException('Query is required');
    }

    const allIngredients = await this.ingredientRepo.find({ take: 500 });
    const matches = allIngredients
      .map(ing => ({
        ...ing,
        similarity: Math.max(
          this.fuzzyScore(query, ing.canonicalName),
          ...ing.inciNames.map(n => this.fuzzyScore(query, n)),
        ),
      }))
      .filter(ing => ing.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10)
      .map(ing => ({
        id: ing.id,
        canonicalName: ing.canonicalName,
        similarity: ing.similarity,
      }));

    return { query, threshold, matches };
  }

  /**
   * Phase 1: Get unrecognized ingredients for a product
   */
  async getUnrecognizedIngredients(productId: string) {
    const product = await this.getProduct(productId);

    if (!product.ingredientsTokens || !Array.isArray(product.ingredientsTokens)) {
      return { productId, unrecognized: [] };
    }

    const unrecognized: any[] = [];

    for (let i = 0; i < product.ingredientsTokens.length; i++) {
      const token = product.ingredientsTokens[i];
      const ingredient = await this.ingredientRepo.findOne({
        where: { canonicalName: token.toLowerCase() },
      });

      if (!ingredient) {
        const matches = await this.fuzzyMatchIngredient(token, 60);
        unrecognized.push({
          token,
          position: i,
          suggestions: matches.matches,
        });
      }
    }

    return { productId, unrecognized };
  }

  /**
   * Phase 2: Manually map an unrecognized ingredient
   */
  async manualMapIngredient(productId: string, unrecognizedToken: string, mappedToCanonicalName: string) {
    const product = await this.getProduct(productId);
    const ingredient = await this.ingredientRepo.findOne({
      where: { canonicalName: mappedToCanonicalName.toLowerCase() },
    });

    if (!ingredient) {
      throw new NotFoundException(`Ingredient "${mappedToCanonicalName}" not found`);
    }

    const tokens = product.ingredientsTokens || [];
    const tokenIndex = tokens.indexOf(unrecognizedToken);

    if (tokenIndex === -1) {
      throw new BadRequestException(`Token "${unrecognizedToken}" not found in product ingredients`);
    }

    tokens[tokenIndex] = mappedToCanonicalName;

    await this.productsRepo.update(productId, {
      ingredientsTokens: tokens,
    } as any);

    return this.getProduct(productId);
  }

  /**
   * Phase 3: Batch fix multiple products
   */
  async batchFixIngredients(productIds: string[], fuzzyThreshold = 70, autoFixOnly = false) {
    const results = [];

    for (const productId of productIds) {
      try {
        const product = await this.getProduct(productId);
        const { unrecognized } = await this.getUnrecognizedIngredients(productId);

        let autoFixed = 0;
        let manualReviewNeeded = unrecognized.length;

        // Auto-fix high-confidence matches
        if (!autoFixOnly || unrecognized.length > 0) {
          for (const item of unrecognized) {
            const topMatch = item.suggestions[0];
            if (topMatch && topMatch.similarity >= fuzzyThreshold) {
              await this.manualMapIngredient(productId, item.token, topMatch.canonicalName);
              autoFixed++;
              manualReviewNeeded--;
            }
          }
        }

        results.push({
          productId,
          fixed: manualReviewNeeded === 0,
          autoFixed,
          manualReviewNeeded,
          unrecognized: unrecognized.slice(0, 5), // Top 5 unrecognized
        });
      } catch (err) {
        results.push({
          productId,
          fixed: false,
          autoFixed: 0,
          manualReviewNeeded: 0,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Phase 3: List all ingredients for management
   */
  async listIngredients(page = 1, limit = 20, search = '', category = '') {
    const qb = this.ingredientRepo.createQueryBuilder('ing');

    if (search) {
      qb.where(
        '(ing.canonicalName ILIKE :search OR CAST(ing.inciNames AS TEXT) ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (category) {
      qb.andWhere('ing.category = :category', { category });
    }

    const total = await qb.getCount();
    const data = await qb
      .orderBy('ing.canonicalName', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { data, total, page, limit };
  }

  /**
   * Phase 3: Create a new ingredient
   */
  async createIngredient(dto: {
    canonicalName: string;
    inciNames: string[];
    category: string;
    effects?: string[];
    description?: string;
  }) {
    const existing = await this.ingredientRepo.findOne({
      where: { canonicalName: dto.canonicalName.toLowerCase() },
    });

    if (existing) {
      throw new BadRequestException(`Ingredient "${dto.canonicalName}" already exists`);
    }

    const ingredient = this.ingredientRepo.create({
      canonicalName: dto.canonicalName,
      inciNames: dto.inciNames,
      category: dto.category,
      effects: dto.effects || [],
      description: dto.description,
      status: 'verified',
      skinTypeScores: {
        dry: 50,
        oily: 50,
        sensitive: 50,
        combination: 50,
        normal: 50,
      },
    });

    return this.ingredientRepo.save(ingredient);
  }

  /**
   * Phase 3: Update an ingredient
   */
  async updateIngredient(id: string, dto: Partial<{
    canonicalName: string;
    inciNames: string[];
    category: string;
    effects: string[];
    description: string;
  }>) {
    const ingredient = await this.ingredientRepo.findOne({ where: { id } });
    if (!ingredient) {
      throw new NotFoundException(`Ingredient not found`);
    }

    Object.assign(ingredient, dto);
    return this.ingredientRepo.save(ingredient);
  }

  /**
   * Phase 3: Delete an ingredient
   */
  async deleteIngredient(id: string) {
    const ingredient = await this.ingredientRepo.findOne({ where: { id } });
    if (!ingredient) {
      throw new NotFoundException(`Ingredient not found`);
    }

    await this.ingredientRepo.remove(ingredient);
    return { success: true };
  }
}

