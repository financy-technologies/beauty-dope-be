import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { IngredientEffect } from './ingredient-effect.entity';
import { IngredientAlias } from './ingredient-alias.entity';

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

export type IngredientStatus = 'verified' | 'pending_review' | 'auto_imported';

@Entity('ingredients')
export class Ingredient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  canonicalName: string;

  // Status: verified = fully curated, pending_review = imported but needs enrichment, auto_imported = from CosIng/PubChem
  @Column({ default: 'pending_review' })
  status: IngredientStatus;

  // EU CosIng / CAS identifiers
  @Column({ nullable: true })
  casNumber?: string;

  @Column({ nullable: true })
  ecNumber?: string;

  // Standardized CosIng function labels (e.g. EMOLLIENT, HUMECTANT, PRESERVATIVE)
  @Column('simple-json', { nullable: true })
  cosingFunctions?: string[];

  @Column('simple-json')
  inciNames: string[];

  @Column()
  category: string;

  @Column('simple-json')
  effects: string[];

  @Column('simple-json')
  skinTypeScores: SkinTypeScores;

  @Column({ type: 'int', default: 0 })
  comedogenicity: number;

  @Column({ default: true })
  fungalAcneSafe: boolean;

  @Column({ default: true })
  pregnancySafe: boolean;

  @Column('simple-json', { nullable: true })
  concentration?: ConcentrationRange;

  @Column('simple-json', { nullable: true })
  synergies?: string[];

  @Column('simple-json', { nullable: true })
  conflicts?: string[];

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column('simple-json', { nullable: true })
  sources?: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => IngredientEffect, (effect) => effect.ingredient, { cascade: true })
  ingredientEffects: IngredientEffect[];

  @OneToMany(() => IngredientAlias, (alias) => alias.ingredient, { cascade: true })
  aliases: IngredientAlias[];
}
