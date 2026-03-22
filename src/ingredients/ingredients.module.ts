import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngredientsService } from './ingredients.service';
import { IngredientsController } from './ingredients.controller';
import { Ingredient } from './entities/ingredient.entity';
import { IngredientEffect } from './entities/ingredient-effect.entity';
import { IngredientAlias } from './entities/ingredient-alias.entity';
import { IngredientsSeedService } from '../database/seeds/ingredients.seed';
import { IngredientParserService } from './ingredient-parser.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ingredient, IngredientEffect, IngredientAlias])],
  providers: [IngredientsService, IngredientsSeedService, IngredientParserService],
  controllers: [IngredientsController],
  exports: [IngredientsService, IngredientsSeedService, IngredientParserService, TypeOrmModule],
})
export class IngredientsModule {}
