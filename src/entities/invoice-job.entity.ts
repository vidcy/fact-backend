import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum JobType {
  SEND_BILL = 'SEND_BILL',
  CHECK_STATUS = 'CHECK_STATUS',
  DISPATCH_WEBHOOK = 'DISPATCH_WEBHOOK',
}

export enum JobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRY = 'RETRY',
}

@Entity('invoice_jobs')
@Index(['status', 'next_run_at'])
@Index(['document_id'])
export class InvoiceJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  company_id: string;

  @Column({ type: 'uuid' })
  document_id: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: JobType.SEND_BILL,
  })
  job_type: JobType;

  @Column({
    type: 'varchar',
    length: 20,
    default: JobStatus.PENDING,
  })
  status: JobStatus;

  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'integer', default: 5 })
  max_attempts: number;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  next_run_at: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  locked_at: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  locked_by: string;

  @Column({ type: 'text', nullable: true })
  last_error: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
