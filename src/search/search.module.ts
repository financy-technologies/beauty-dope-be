import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { Dupe } from '../dupes/entities/dupe.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Dupe])],
  providers: [SearchService],
  controllers: [SearchController],
})
export class SearchModule {}
