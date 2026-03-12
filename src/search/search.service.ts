import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dupe } from '../dupes/entities/dupe.entity';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Dupe)
    private dupesRepo: Repository<Dupe>,
  ) {}

  async searchDupes(q: string) {
    if (!q || q.length < 2) return [];

    const results = await this.dupesRepo
      .createQueryBuilder('dupe')
      .leftJoinAndSelect('dupe.originalProduct', 'original')
      .leftJoinAndSelect('dupe.dupeProduct', 'dupeProduct')
      .where(
        'original.name LIKE :q OR original.brand LIKE :q OR dupeProduct.name LIKE :q OR dupeProduct.brand LIKE :q',
        { q: `%${q}%` },
      )
      .orderBy('dupe.similarityScore', 'DESC')
      .getMany();

    return results.map((d) => ({
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
      },
      dupe: {
        id: d.dupeProduct.id,
        name: d.dupeProduct.name,
        brand: d.dupeProduct.brand,
        price: Number(d.dupeProduct.price),
        image: d.dupeProduct.imageUrl || '',
      },
    }));
  }
}
