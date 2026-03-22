import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngredientsService } from './ingredients.service';
import { IngredientsController } from './ingredients.controller';
import { Ingredient } from './entities/ingredient.entity';
import { IngredientEffect } from './entities/ingredient-effect.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Ingredient, IngredientEffect])],
  providers: [IngredientsService],
  controllers: [IngredientsController],
  exports: [IngredientsService, TypeOrmModule],
})
export class IngredientsModule {}
