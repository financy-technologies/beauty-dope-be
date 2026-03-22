import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Ingredient } from './ingredient.entity';

export type AliasType =
  | 'inci'        // official INCI variant
  | 'common'      // everyday name (e.g. "Vitamin C")
  | 'trade'       // brand/trade name
  | 'language'    // non-English name (Eau, Agua, Wasser)
  | 'abbreviation'// HA, AHA, BHA
  | 'ocr_variant' // common OCR/typo variant
  | 'cosing'      // imported from CosIng
  | 'pubchem';    // imported from PubChem synonyms

@Entity('ingredient_aliases')
export class IngredientAlias {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  aliasText: string; // lowercase, trimmed — used for fast lookup

  @Column()
  aliasType: AliasType;

  @Column()
  ingredientId: string;

  @ManyToOne(() => Ingredient, (ingredient) => ingredient.aliases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ingredient_id' })
  ingredient: Ingredient;
}
