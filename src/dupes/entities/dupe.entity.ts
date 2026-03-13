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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Review, (review) => review.dupe)
  reviews: Review[];

  @OneToMany(() => UserFavorite, (fav) => fav.dupe)
  favoritedBy: UserFavorite[];
}
