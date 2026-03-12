import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DupesService } from './dupes.service';
import { DupesController } from './dupes.controller';
import { Dupe } from './entities/dupe.entity';
import { Product } from '../products/entities/product.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Dupe, Product])],
  providers: [DupesService],
  controllers: [DupesController],
  exports: [DupesService, TypeOrmModule],
})
export class DupesModule {}
