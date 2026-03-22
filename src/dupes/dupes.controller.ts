import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DupesService } from './dupes.service';
import { DupeEngineService } from './dupe-engine.service';
import { CreateDupeDto } from './dto/create-dupe.dto';
import { QueryDupesDto } from './dto/query-dupes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FilterDupesByIngredientsDto, CompareIngredientsDto } from './dto/filter-dupes-by-ingredients.dto';

@Controller('dupes')
export class DupesController {
  constructor(
    private dupesService: DupesService,
    private dupeEngine: DupeEngineService,
  ) {}

  @Get()
  findAll(@Query() query: QueryDupesDto) {
    return this.dupesService.findAll(query);
  }

  @Get('featured')
  findFeatured(@Query('limit') limit?: number) {
    return this.dupesService.findFeatured(limit ? Number(limit) : 4);
  }

  @Get('trending')
  findTrending(@Query('limit') limit?: number) {
    return this.dupesService.findTrending(limit ? Number(limit) : 5);
  }

  /**
   * POST /dupes/run-detection
   * Runs the full dupe detection pipeline over all products and saves results.
   * No auth required — dev/admin use.
   */
  @Post('run-detection')
  runDetection() {
    return this.dupeEngine.runFullDetection();
  }

  /**
   * GET /dupes/by-product/:productId
   * Returns ranked dupes for a specific product.
   * If the product is a dupe itself, returns what it duplicates.
   */
  @Get('by-product/:productId')
  findByProduct(@Param('productId') productId: string) {
    return this.dupesService.findByProduct(productId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dupesService.findOne(id);
  }

  /**
   * POST /dupes/filter-by-ingredients
   * Find dupes for a product with ingredient preferences (include/exclude)
   * and skin type preferences
   */
  @Post('filter-by-ingredients')
  async filterByIngredients(@Body() dto: FilterDupesByIngredientsDto) {
    return this.dupesService.findDupesWithIngredientFilters(dto);
  }

  /**
   * POST /dupes/compare-ingredients
   * Compare ingredients between two products
   */
  @Post('compare-ingredients')
  async compareIngredients(@Body() dto: CompareIngredientsDto) {
    return this.dupesService.compareProductIngredients(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateDupeDto) {
    return this.dupesService.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateDupeDto>) {
    return this.dupesService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.dupesService.remove(id);
  }
}
