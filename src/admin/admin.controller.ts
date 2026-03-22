import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { IngredientsSeedService } from '../database/seeds/ingredients.seed';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private adminService: AdminService,
    private ingredientsSeedService: IngredientsSeedService,
  ) {}

  @Post('seed-ingredients')
  seedIngredients() {
    return this.ingredientsSeedService.seed();
  }

  // Stats
  @Get('stats')
  getStats() { return this.adminService.getStats(); }

  // Users
  @Get('users')
  listUsers(@Query('page') page = 1, @Query('limit') limit = 20, @Query('search') search = '') {
    return this.adminService.listUsers(+page, +limit, search);
  }
  @Get('users/:id')
  getUser(@Param('id') id: string) { return this.adminService.getUser(id); }
  @Post('users')
  createUser(@Body() dto: any) { return this.adminService.createUser(dto); }
  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: any) { return this.adminService.updateUser(id, dto); }
  @Delete('users/:id') @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(@Param('id') id: string) { return this.adminService.deleteUser(id); }

  // Products
  @Get('products')
  listProducts(@Query('page') page = 1, @Query('limit') limit = 20, @Query('search') search = '') {
    return this.adminService.listProducts(+page, +limit, search);
  }
  @Get('products/:id')
  getProduct(@Param('id') id: string) { return this.adminService.getProduct(id); }
  @Post('products')
  createProduct(@Body() dto: any) { return this.adminService.createProduct(dto); }
  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: any) { return this.adminService.updateProduct(id, dto); }
  @Delete('products/:id') @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(@Param('id') id: string) { return this.adminService.deleteProduct(id); }

  // Dupes
  @Get('dupes')
  listDupes(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.listDupes(+page, +limit);
  }
  @Get('dupes/:id')
  getDupe(@Param('id') id: string) { return this.adminService.getDupe(id); }
  @Post('dupes')
  createDupe(@Body() dto: any) { return this.adminService.createDupe(dto); }
  @Patch('dupes/:id')
  updateDupe(@Param('id') id: string, @Body() dto: any) { return this.adminService.updateDupe(id, dto); }
  @Delete('dupes/:id') @HttpCode(HttpStatus.NO_CONTENT)
  deleteDupe(@Param('id') id: string) { return this.adminService.deleteDupe(id); }

  // Reviews
  @Get('reviews')
  listReviews(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.listReviews(+page, +limit);
  }
  @Patch('reviews/:id')
  updateReview(@Param('id') id: string, @Body() dto: any) { return this.adminService.updateReview(id, dto); }
  @Delete('reviews/:id') @HttpCode(HttpStatus.NO_CONTENT)
  deleteReview(@Param('id') id: string) { return this.adminService.deleteReview(id); }
}
