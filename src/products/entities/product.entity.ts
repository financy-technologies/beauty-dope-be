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

  @Column({ name: 'image_url', nullable: true })
  imageUrl: string;

  @Column()
  @Index()
  category: string;

  @Column({ nullable: true })
  subcategory: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Dupe, (dupe) => dupe.originalProduct)
  originalDupes: Dupe[];

  @OneToMany(() => Dupe, (dupe) => dupe.dupeProduct)
  dupeOf: Dupe[];
}
