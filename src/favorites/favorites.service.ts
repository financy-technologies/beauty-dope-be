import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserFavorite } from './entities/favorite.entity';
import { Dupe } from '../dupes/entities/dupe.entity';

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
    },
    dupe: {
      id: d.dupeProduct.id,
      name: d.dupeProduct.name,
      brand: d.dupeProduct.brand,
      price: Number(d.dupeProduct.price),
      image: d.dupeProduct.imageUrl || '',
    },
  };
}

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(UserFavorite)
    private favoritesRepo: Repository<UserFavorite>,
    @InjectRepository(Dupe)
    private dupesRepo: Repository<Dupe>,
  ) {}

  async getFavoriteIds(userId: string): Promise<string[]> {
    const favs = await this.favoritesRepo.find({
      where: { user: { id: userId } },
      relations: ['dupe'],
    });
    return favs.map((f) => f.dupe.id);
  }

  async getFavoriteDupes(userId: string) {
    const favs = await this.favoritesRepo.find({
      where: { user: { id: userId } },
      relations: [
        'dupe',
        'dupe.originalProduct',
        'dupe.dupeProduct',
      ],
      order: { createdAt: 'DESC' },
    });
    return favs.map((f) => mapDupe(f.dupe));
  }

  async add(dupeId: string, userId: string) {
    const dupe = await this.dupesRepo.findOne({ where: { id: dupeId } });
    if (!dupe) throw new NotFoundException(`Dupe ${dupeId} not found`);

    const existing = await this.favoritesRepo.findOne({
      where: { user: { id: userId }, dupe: { id: dupeId } },
    });
    if (existing) throw new ConflictException('Already in favorites');

    const fav = this.favoritesRepo.create({
      user: { id: userId } as any,
      dupe: { id: dupeId } as Dupe,
    });
    return this.favoritesRepo.save(fav);
  }

  async remove(dupeId: string, userId: string) {
    const fav = await this.favoritesRepo.findOne({
      where: { user: { id: userId }, dupe: { id: dupeId } },
    });
    if (!fav) throw new NotFoundException('Favorite not found');
    await this.favoritesRepo.remove(fav);
  }
}
