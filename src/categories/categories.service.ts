import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Category } from './entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private categoriesRepo: Repository<Category>,
    private readonly dataSource: DataSource,
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

  /**
   * Derive categories + subcategories from the products table and upsert
   * into the categories table. Safe to run repeatedly — fully idempotent.
   */
  async syncFromProducts(): Promise<{ synced: number; categories: object[] }> {
    const rows: { category: string; subcategory: string; cnt: string }[] =
      await this.dataSource.query(`
        SELECT category, subcategory, COUNT(*) as cnt
        FROM products
        WHERE category IS NOT NULL AND subcategory IS NOT NULL
        GROUP BY category, subcategory
        ORDER BY category, subcategory
      `);

    // Build map: category → { subcategories Set, total productCount }
    const catMap = new Map<string, { subcategories: Set<string>; productCount: number }>();
    for (const row of rows) {
      if (!catMap.has(row.category)) {
        catMap.set(row.category, { subcategories: new Set(), productCount: 0 });
      }
      const entry = catMap.get(row.category)!;
      if (row.subcategory) entry.subcategories.add(row.subcategory);
      entry.productCount += parseInt(row.cnt, 10);
    }

    const synced: object[] = [];

    for (const [name, { subcategories, productCount }] of catMap.entries()) {
      const slug = name.toLowerCase().replace(/\s+/g, '-');
      const existing = await this.categoriesRepo.findOne({ where: { slug } });

      if (existing) {
        await this.categoriesRepo.update(existing.id, {
          subcategories: [...subcategories],
        });
        synced.push({ name, slug, subcategories: [...subcategories], productCount, action: 'updated' });
      } else {
        await this.categoriesRepo.save(
          this.categoriesRepo.create({ name, slug, subcategories: [...subcategories] }),
        );
        synced.push({ name, slug, subcategories: [...subcategories], productCount, action: 'created' });
      }
    }

    return { synced: synced.length, categories: synced };
  }
}
