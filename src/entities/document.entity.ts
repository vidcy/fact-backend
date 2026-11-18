import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from './company.entity';
import { DocumentItem } from './document-item.entity';

export enum DocumentStatus {
  DRAFT = 'DRAFT',
  SIGNED = 'SIGNED',
  QUEUED = 'QUEUED',
  SENDING = 'SENDING',
  ACCEPTED = 'ACCEPTED',
  ACCEPTED_OBSERVED = 'ACCEPTED_OBSERVED',
  REJECTED = 'REJECTED',
  FAILED_RETRY = 'FAILED_RETRY',
  ANULADO = 'ANULADO',
}

@Entity('documents')
@Index(['company_id', 'document_type', 'series', 'number'], { unique: true })
@Index(['company_id', 'idempotency_key'], { unique: true })
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  company_id: string;

  @ManyToOne(() => Company, (c) => c.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  idempotency_key: string | null;

  @Column({ type: 'varchar', length: 2 })
  document_type: string; // 01 Factura, 03 Boleta, 07 NC, 08 ND

  @Column({ type: 'varchar', length: 4 })
  series: string;

  @Column({ type: 'integer' })
  number: number;

  @Column({ type: 'varchar', length: 20 })
  full_number: string; // e.g. F001-00000001

  @Column({ type: 'varchar', length: 10 })
  issue_date: string; // YYYY-MM-DD

  @Column({ type: 'varchar', length: 8 })
  issue_time: string; // HH:mm:ss

  @Column({ type: 'varchar', length: 10, nullable: true })
  due_date: string | null;

  @Column({ type: 'varchar', length: 3, default: 'PEN' })
  currency: string; // PEN, USD

  @Column({ type: 'varchar', length: 4, default: '0101' })
  operation_type: string;

  @Column({ type: 'varchar', length: 20, default: 'Contado' })
  payment_type: string; // Contado, Credito

  @Column({ type: 'jsonb', nullable: true })
  payment_terms: any;

  // Receptor / Cliente
  @Column({ type: 'varchar', length: 1 })
  client_doc_type: string; // 6 RUC, 1 DNI, 4 CE, 7 Pasaporte, 0 Sin Doc

  @Column({ type: 'varchar', length: 15 })
  client_doc_number: string;

  @Column({ type: 'varchar', length: 255 })
  client_name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  client_address: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  client_email: string;

  // Montos
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_gravada: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_exonerada: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_inafecta: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_gratuita: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_igv: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_isc: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_icbper: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_descuentos: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_cargos: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total_amount: number;

  // Referencias para NC y ND
  @Column({ type: 'varchar', length: 2, nullable: true })
  ref_document_type: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  ref_series: string | null;

  @Column({ type: 'integer', nullable: true })
  ref_number: number | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  ref_reason_code: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ref_reason_desc: string | null;

  // SUNAT Hashes & XML
  @Column({ type: 'varchar', length: 64, nullable: true })
  xml_digest_value: string;

  @Column({ type: 'text', nullable: true })
  xml_signature_value: string;

  @Column({ type: 'text', nullable: true })
  qr_data: string;

  @Column({ type: 'text', nullable: true })
  xml_content: string;

  @Column({ type: 'text', nullable: true })
  cdr_xml: string | null;

  @Column({ type: 'text', nullable: true })
  cdr_zip_base64: string | null;

  // Estados y Respuestas SUNAT
  @Column({
    type: 'varchar',
    length: 25,
    default: DocumentStatus.DRAFT,
  })
  status: DocumentStatus;

  @Column({ type: 'varchar', length: 20, nullable: true })
  sunat_response_code: string | null;

  @Column({ type: 'text', nullable: true })
  sunat_description: string | null;

  @Column({ type: 'jsonb', nullable: true })
  sunat_notes: any;

  @Column({ type: 'timestamp with time zone', nullable: true })
  sunat_sent_at: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  sunat_response_at: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @OneToMany(() => DocumentItem, (item) => item.document, { cascade: true })
  items: DocumentItem[];

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
