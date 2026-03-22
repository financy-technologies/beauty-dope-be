import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Ingredient } from './ingredient.entity';

@Entity('ingredient_effects')
export class IngredientEffect {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ingredientId: string;

  @Column()
  effect: string; // anti-aging, hydrating, brightening, etc.

  @Column('decimal', { precision: 3, scale: 2 })
  confidence: number; // 0-1 scale indicating strength of evidence

  @Column('simple-json', { nullable: true })
  skinTypes?: string[]; // which skin types benefit most

  @Column({ type: 'text', nullable: true })
  description?: string;

  @ManyToOne(() => Ingredient, (ingredient) => ingredient.ingredientEffects, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ingredient_id' })
  ingredient: Ingredient;
}
