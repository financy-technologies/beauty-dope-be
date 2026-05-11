import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindManyOptions, IsNull, Brackets } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Product } from '../products/entities/product.entity';
import { Dupe } from '../dupes/entities/dupe.entity';
import { Review } from '../reviews/entities/review.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)    private usersRepo: Repository<User>,
    @InjectRepository(Product) private productsRepo: Repository<Product>,
    @InjectRepository(Dupe)    private dupesRepo: Repository<Dupe>,
    @InjectRepository(Review)  private reviewsRepo: Repository<Review>,
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
}
