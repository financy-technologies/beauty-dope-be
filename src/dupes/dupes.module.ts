import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DupesService } from './dupes.service';
import { DupesController } from './dupes.controller';
import { DupeEngineService } from './dupe-engine.service';
import { Dupe } from './entities/dupe.entity';
import { Product } from '../products/entities/product.entity';
import { IngredientParserService } from '../scraping/ingredient-parser.service';
import { IngredientsModule } from '../ingredients/ingredients.module';

@Module({
  imports: [TypeOrmModule.forFeature([Dupe, Product]), IngredientsModule],
  providers: [DupesService, DupeEngineService, IngredientParserService],
  controllers: [DupesController],
  exports: [DupesService, DupeEngineService, TypeOrmModule],
})
export class DupesModule {}
