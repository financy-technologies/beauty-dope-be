import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FavoritesService } from './favorites.service';
import { FavoritesController } from './favorites.controller';
import { UserFavorite } from './entities/favorite.entity';
import { Dupe } from '../dupes/entities/dupe.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserFavorite, Dupe])],
  providers: [FavoritesService],
  controllers: [FavoritesController],
})
export class FavoritesModule {}
