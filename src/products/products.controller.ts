import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

export enum FlagReason {
  WRONG_INGREDIENTS = 'wrong_ingredients',
  WRONG_PRICE = 'wrong_price',
  WRONG_IMAGE = 'wrong_image',
  DUPLICATE = 'duplicate',
  DISCONTINUED = 'discontinued',
  OTHER = 'other',
}

export class FlagProductDto {
  @IsEnum(FlagReason)
  reason: FlagReason;

  @IsOptional()
  @IsString()
  note?: string;
}

@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  findAll(
    @Query('q')          q?: string,
    @Query('limit')      limit?: string,
    @Query('offset')     offset?: string,
    @Query('category')   category?: string,
    @Query('sort')       sort?: string,
  ) {
    const parsedLimit  = limit  ? parseInt(limit,  10) : 20;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;
    if (q && q.trim().length >= 2) {
      return this.productsService.search(q, parsedLimit, category);
    }
    return this.productsService.findAll(parsedLimit, parsedOffset, category, sort);
  }

  @Get('brands')
  getTopBrands(@Query('limit') limit?: string) {
    return this.productsService.getTopBrands(limit ? parseInt(limit, 10) : 20);
  }

  @Get(':id/detail')
  getDetail(@Param('id') id: string) {
    return this.productsService.getProductDetail(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.getWithParsedIngredients(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  // Public — any user can flag a product for review
  @Post(':id/flag')
  @HttpCode(HttpStatus.NO_CONTENT)
  flag(@Param('id') id: string, @Body() dto: FlagProductDto) {
    return this.productsService.flag(id, dto.reason, dto.note);
  }
}
