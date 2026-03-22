import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { IngredientEffect } from './ingredient-effect.entity';

export interface SkinTypeScores {
  dry: number;
  oily: number;
  sensitive: number;
  combination: number;
  normal: number;
}

export interface ConcentrationRange {
  min?: number;
  max?: number;
  unit: 'percent' | 'ppm';
}

@Entity('ingredients')
export class Ingredient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  canonicalName: string;

  @Column('simple-json')
  inciNames: string[];

  @Column()
  category: string; // Active, Humectant, Emollient, Preservative, Chelating Agent, etc.

  @Column('simple-json')
  effects: string[]; // anti-aging, hydrating, brightening, anti-inflammatory, exfoliating, soothing, etc.

  @Column('simple-json')
  skinTypeScores: SkinTypeScores;

  @Column({ type: 'int' })
  comedogenicity: number; // 0-5 scale

  @Column({ default: true })
  fungalAcneSafe: boolean;

  @Column({ default: true })
  pregnancySafe: boolean;

  @Column('simple-json', { nullable: true })
  concentration?: ConcentrationRange;

  @Column('simple-json', { nullable: true })
  synergies?: string[]; // ingredient canonical names that work well together

  @Column('simple-json', { nullable: true })
  conflicts?: string[]; // ingredient canonical names to avoid combining with

  @Column({ type: 'text' })
  description: string;

  @Column('simple-json', { nullable: true })
  sources?: string[]; // research citations

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => IngredientEffect, (effect) => effect.ingredient, { cascade: true })
  ingredientEffects: IngredientEffect[];
}
