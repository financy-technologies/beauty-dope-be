import {
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Dupe } from '../../dupes/entities/dupe.entity';

@Entity('user_favorites')
@Unique(['user', 'dupe'])
export class UserFavorite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.favorites, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  @Index()
  user: User;

  @ManyToOne(() => Dupe, (dupe) => dupe.favoritedBy, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dupe_id' })
  dupe: Dupe;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
