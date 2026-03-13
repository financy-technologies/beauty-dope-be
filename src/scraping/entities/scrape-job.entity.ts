import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type ScrapeJobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

@Entity('scrape_jobs')
export class ScrapeJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'job_name' })
  jobName: string;

  @Column()
  @Index()
  source: string;

  @Column({ type: 'varchar', default: 'PENDING' })
  @Index()
  status: ScrapeJobStatus;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date;

  @Column({ name: 'products_created', default: 0 })
  productsCreated: number;

  @Column({ name: 'products_updated', default: 0 })
  productsUpdated: number;

  @Column({ name: 'dupes_created', default: 0 })
  dupesCreated: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
