import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private categoriesRepo: Repository<Category>,
  ) {}

  findAll() {
    return this.categoriesRepo.find({ order: { name: 'ASC' } });
  }

  async findBySlug(slug: string) {
    const cat = await this.categoriesRepo.findOne({ where: { slug } });
    if (!cat) throw new NotFoundException(`Category '${slug}' not found`);
    return cat;
  }

  create(dto: CreateCategoryDto) {
    const category = this.categoriesRepo.create(dto);
    return this.categoriesRepo.save(category);
  }
}
