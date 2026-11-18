import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Document } from './document.entity';

@Entity('document_items')
export class DocumentItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  document_id: string;

  @ManyToOne(() => Document, (d) => d.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ type: 'integer' })
  item_order: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  code: string;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'varchar', length: 5, default: 'NIU' })
  unit_measure: string;

  @Column({ type: 'numeric', precision: 12, scale: 4 })
  quantity: number;

  @Column({ type: 'numeric', precision: 12, scale: 4 })
  unit_value: number;

  @Column({ type: 'numeric', precision: 12, scale: 4 })
  unit_price: number;

  @Column({ type: 'varchar', length: 2, default: '10' })
  igv_affectation_type: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 18.0 })
  igv_percentage: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  igv_amount: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total: number;
}
