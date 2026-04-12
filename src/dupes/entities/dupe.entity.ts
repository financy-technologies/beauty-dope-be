import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { Review } from '../../reviews/entities/review.entity';
import { UserFavorite } from '../../favorites/entities/favorite.entity';

@Entity('dupes')
@Unique(['originalProduct', 'dupeProduct'])
export class Dupe {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, (p) => p.originalDupes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'original_product_id' })
  @Index()
  originalProduct: Product;

  @ManyToOne(() => Product, (p) => p.dupeOf, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dupe_product_id' })
  dupeProduct: Product;

  @Column({ name: 'similarity_score' })
  similarityScore: number;

  @Column({ name: 'savings_percent' })
  savingsPercent: number;

  @Column()
  @Index()
  category: string;

  @Column({ name: 'total_votes', default: 0 })
  totalVotes: number;

  @Column('decimal', { name: 'avg_rating', precision: 3, scale: 2, default: 0 })
  avgRating: number;

  @Column({ name: 'is_featured', default: false })
  @Index()
  isFeatured: boolean;

  @Column({ name: 'is_trending', default: false })
  @Index()
  isTrending: boolean;

  @Column({ name: 'scoring_method', nullable: true })
  scoringMethod: string;

  @Column({ name: 'score_confidence', nullable: true })
  scoreConfidence: number;

  @Column({ name: 'score_version', nullable: true })
  scoreVersion: string;

  @Column({ name: 'score_calculated_at', type: 'timestamp', nullable: true })
  scoreCalculatedAt: Date;

  /** Rank among all dupes for the same originalProduct (1 = best match) */
  @Column({ name: 'dupe_rank', nullable: true })
  dupeRank: number;

  /** Quality tier label */
  @Column({ name: 'dupe_label', nullable: true, length: 20 })
  dupeLabel: string;  // 'exact-match' | 'close-dupe' | 'inspired-by'

  /** How many times more expensive the original is vs the dupe */
  @Column('decimal', { name: 'price_ratio', precision: 5, scale: 2, nullable: true })
  priceRatio: number;

  /** Key actives shared between both products */
  @Column('simple-json', { name: 'shared_actives', nullable: true })
  sharedActives: string[];

  // ── v3 diagnostic columns ────────────────────────────────────────────────

  /** Mechanism-of-action similarity sub-score (0.000–1.000) */
  @Column('decimal', { name: 'mechanism_score', precision: 5, scale: 3, nullable: true })
  mechanismScore: number;

  /** Percentage of original's key actives present in the dupe (0–100) */
  @Column({ name: 'active_overlap_pct', type: 'int', nullable: true })
  activeOverlapPct: number;

  /** Key actives from the original product that are absent in the dupe */
  @Column('simple-json', { name: 'missing_actives', nullable: true })
  missingActives: string[];

  /** Inferred primary skin concern of the original product */
  @Column({ name: 'primary_concern', nullable: true, length: 32 })
  primaryConcern: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Review, (review) => review.dupe)
  reviews: Review[];

  @OneToMany(() => UserFavorite, (fav) => fav.dupe)
  favoritedBy: UserFavorite[];
}
