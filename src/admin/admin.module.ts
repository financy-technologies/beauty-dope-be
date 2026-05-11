import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User } from '../auth/entities/user.entity';
import { Product } from '../products/entities/product.entity';
import { Dupe } from '../dupes/entities/dupe.entity';
import { Review } from '../reviews/entities/review.entity';
import { Ingredient } from '../ingredients/entities/ingredient.entity';
import { AuthModule } from '../auth/auth.module';
import { IngredientsModule } from '../ingredients/ingredients.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Product, Dupe, Review, Ingredient]),
    AuthModule,
    IngredientsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
