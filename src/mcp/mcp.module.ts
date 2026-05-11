import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { ScrapingModule } from '../scraping/scraping.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [ScrapingModule, ProductsModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
