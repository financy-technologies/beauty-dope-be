import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { IngredientParserService } from '../ingredients/ingredient-parser.service';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productsRepo: Repository<Product>,
    private ingredientParser: IngredientParserService,
  ) {}

  findAll() {
    return this.productsRepo.find({ order: { createdAt: 'DESC' } });
  }

  async search(q: string, limit = 8): Promise<Product[]> {
    if (!q || q.trim().length < 2) return [];
    return this.productsRepo
      .createQueryBuilder('product')
      .where('product.name LIKE :q OR product.brand LIKE :q', { q: `%${q.trim()}%` })
      .orderBy('product.brand', 'ASC')
      .addOrderBy('product.name', 'ASC')
      .limit(limit)
      .getMany();
  }

  async findOne(id: string) {
    const product = await this.productsRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async getWithParsedIngredients(id: string) {
    const product = await this.findOne(id);
    const parsedIngredients = product.ingredients
      ? await this.ingredientParser.parseIngredientList(product.ingredients)
      : [];
    return { ...product, parsedIngredients };
  }

  create(dto: CreateProductDto) {
    const product = this.productsRepo.create(dto);
    return this.productsRepo.save(product);
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    await this.productsRepo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.productsRepo.delete(id);
  }

  async flag(id: string, reason: string, note?: string) {
    await this.findOne(id);
    await this.productsRepo.update(id, {
      flaggedReason: reason,
      flagNote: note ?? null,
      flaggedAt: new Date(),
    });
  }
}
