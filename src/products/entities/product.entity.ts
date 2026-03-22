import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { Dupe } from '../../dupes/entities/dupe.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  @Index()
  brand: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column({ nullable: true, length: 3 })
  currency: string;

  @Column('decimal', { name: 'normalized_price_inr', precision: 10, scale: 2, nullable: true })
  normalizedPriceInr: number;

  @Column({ name: 'image_url', nullable: true })
  imageUrl: string;

  @Column({ nullable: true })
  @Index()
  platform: string;

  @Column({ nullable: true })
  @Index()
  store: string;

  @Column()
  @Index()
  category: string;

  @Column({ nullable: true })
  @Index()
  subcategory: string;

  @Column({ nullable: true })
  size: string;

  @Column({ type: 'int', nullable: true })
  quantity: number;

  @Column({ type: 'text', nullable: true })
  ingredients: string;

  @Column('simple-json', { name: 'ingredients_tokens', nullable: true })
  ingredientsTokens: string[];

  @Column('simple-json', { name: 'ingredient_breakdown', nullable: true })
  ingredientBreakdown?: {
    tokenCount: number;
    actives: string[];
    humectants: string[];
    emollients: string[];
    preservatives: string[];
    chelatingAgents: string[];
    comedogenicCount: number;
    maxComedogenicity: number;
    fungalAcneSafe: boolean;
    pregnancySafe: boolean;
  };

  @Column('simple-json', { name: 'skin_type_suitability', nullable: true })
  skinTypeSuitability?: {
    dry: number;
    oily: number;
    sensitive: number;
    combination: number;
    normal: number;
  };

  @Column('simple-json', { name: 'skin_type_recommended_for', nullable: true })
  skinTypeRecommendedFor?: string[];

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  @Index()
  source: string;

  @Column({ name: 'external_id', nullable: true, unique: true })
  externalId: string;

  @Column({ name: 'source_url', nullable: true })
  sourceUrl: string;

  @Column({ name: 'scraped_at', type: 'timestamp', nullable: true })
  scrapedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Dupe, (dupe) => dupe.originalProduct)
  originalDupes: Dupe[];

  @OneToMany(() => Dupe, (dupe) => dupe.dupeProduct)
  dupeOf: Dupe[];
}
