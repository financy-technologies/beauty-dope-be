import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngredientsService } from './ingredients.service';
import { IngredientsController } from './ingredients.controller';
import { Ingredient } from './entities/ingredient.entity';
import { IngredientEffect } from './entities/ingredient-effect.entity';
import { IngredientsSeedService } from '../database/seeds/ingredients.seed';

@Module({
  imports: [TypeOrmModule.forFeature([Ingredient, IngredientEffect])],
  providers: [IngredientsService, IngredientsSeedService],
  controllers: [IngredientsController],
  exports: [IngredientsService, IngredientsSeedService, TypeOrmModule],
})
export class IngredientsModule {}
