import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from './company.entity';

@Entity('series')
@Index(['company_id', 'document_type', 'series'], { unique: true })
export class Series {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  company_id: string;

  @ManyToOne(() => Company, (c) => c.series_list, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'varchar', length: 2 })
  document_type: string; // 01, 03, 07, 08

  @Column({ type: 'varchar', length: 4 })
  series: string; // F001, B001, FC01, BC01, etc.

  @Column({ type: 'integer', default: 0 })
  current_number: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
