import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dupe } from './entities/dupe.entity';
import { Product } from '../products/entities/product.entity';
import { CreateDupeDto } from './dto/create-dupe.dto';
import { QueryDupesDto } from './dto/query-dupes.dto';

const PRODUCT_RELATIONS = ['originalProduct', 'dupeProduct'];

function mapDupe(d: Dupe) {
  return {
    id: d.id,
    similarityScore: d.similarityScore,
    savingsPercent: d.savingsPercent,
    category: d.category,
    totalVotes: d.totalVotes,
    avgRating: Number(d.avgRating),
    isFeatured: d.isFeatured,
    isTrending: d.isTrending,
    createdAt: d.createdAt,
    original: {
      id: d.originalProduct.id,
      name: d.originalProduct.name,
      brand: d.originalProduct.brand,
      price: Number(d.originalProduct.price),
      image: d.originalProduct.imageUrl || '',
      description: d.originalProduct.description || null,
    },
    dupe: {
      id: d.dupeProduct.id,
      name: d.dupeProduct.name,
      brand: d.dupeProduct.brand,
      price: Number(d.dupeProduct.price),
      image: d.dupeProduct.imageUrl || '',
      description: d.dupeProduct.description || null,
    },
  };
}

@Injectable()
export class DupesService {
  constructor(
    @InjectRepository(Dupe)
    private dupesRepo: Repository<Dupe>,
    @InjectRepository(Product)
    private productsRepo: Repository<Product>,
  ) {}

  async findAll(query: QueryDupesDto) {
    const { category, limit = 10, offset = 0, sort = 'created_at' } = query;

    const qb = this.dupesRepo
      .createQueryBuilder('dupe')
      .leftJoinAndSelect('dupe.originalProduct', 'original')
      .leftJoinAndSelect('dupe.dupeProduct', 'dupeProduct');

    if (category) {
      qb.where('dupe.category = :category', { category });
    }

    switch (sort) {
      case 'similarity':
        qb.orderBy('dupe.similarityScore', 'DESC');
        break;
      case 'savings':
        qb.orderBy('dupe.savingsPercent', 'DESC');
        break;
      case 'rating':
        qb.orderBy('dupe.avgRating', 'DESC');
        break;
      case 'trending':
        qb.orderBy('dupe.totalVotes', 'DESC');
        break;
      default:
        qb.orderBy('dupe.createdAt', 'DESC');
    }

    const [dupes, total] = await qb.skip(offset).take(limit).getManyAndCount();

    return {
      data: dupes.map(mapDupe),
      total,
      limit,
      offset,
    };
  }

  async findFeatured(limit = 4) {
    const dupes = await this.dupesRepo.find({
      where: { isFeatured: true },
      relations: PRODUCT_RELATIONS,
      order: { similarityScore: 'DESC' },
      take: limit,
    });
    return dupes.map(mapDupe);
  }

  async findTrending(limit = 5) {
    const dupes = await this.dupesRepo.find({
      where: { isTrending: true },
      relations: ['originalProduct', 'dupeProduct'],
      order: { totalVotes: 'DESC' },
      take: limit,
    });

    return dupes.map((d, index) => ({
      id: d.id,
      rank: index + 1,
      original: { brand: d.originalProduct.brand, name: d.originalProduct.name },
      dupe: { brand: d.dupeProduct.brand, name: d.dupeProduct.name },
      savings: `$${Math.round((Number(d.originalProduct.price) * d.savingsPercent) / 100)}`,
      votes: d.totalVotes,
      rating: Number(d.avgRating),
    }));
  }

  async findOne(id: string) {
    const dupe = await this.dupesRepo.findOne({
      where: { id },
      relations: PRODUCT_RELATIONS,
    });
    if (!dupe) throw new NotFoundException(`Dupe ${id} not found`);
    return mapDupe(dupe);
  }

  async create(dto: CreateDupeDto) {
    const original = await this.productsRepo.findOne({ where: { id: dto.originalProductId } });
    if (!original) throw new NotFoundException(`Product ${dto.originalProductId} not found`);

    const dupeProduct = await this.productsRepo.findOne({ where: { id: dto.dupeProductId } });
    if (!dupeProduct) throw new NotFoundException(`Product ${dto.dupeProductId} not found`);

    const dupe = this.dupesRepo.create({
      originalProduct: original,
      dupeProduct: dupeProduct,
      similarityScore: dto.similarityScore,
      savingsPercent: dto.savingsPercent,
      category: dto.category,
      isFeatured: dto.isFeatured ?? false,
      isTrending: dto.isTrending ?? false,
    });
    const saved = await this.dupesRepo.save(dupe);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: Partial<CreateDupeDto>) {
    await this.findOne(id);
    const update: any = {};
    if (dto.similarityScore !== undefined) update.similarityScore = dto.similarityScore;
    if (dto.savingsPercent !== undefined) update.savingsPercent = dto.savingsPercent;
    if (dto.category !== undefined) update.category = dto.category;
    if (dto.isFeatured !== undefined) update.isFeatured = dto.isFeatured;
    if (dto.isTrending !== undefined) update.isTrending = dto.isTrending;
    await this.dupesRepo.update(id, update);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.dupesRepo.delete(id);
  }

  async recalculateStats(dupeId: string) {
    const result = await this.dupesRepo
      .createQueryBuilder('dupe')
      .leftJoin('dupe.reviews', 'review')
      .select('COUNT(review.id)', 'totalVotes')
      .addSelect('COALESCE(AVG(review.rating), 0)', 'avgRating')
      .where('dupe.id = :dupeId', { dupeId })
      .getRawOne();

    await this.dupesRepo.update(dupeId, {
      totalVotes: parseInt(result.totalVotes) || 0,
      avgRating: parseFloat(result.avgRating) || 0,
    });
  }
}
