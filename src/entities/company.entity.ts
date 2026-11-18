import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Branch } from './branch.entity';
import { Series } from './series.entity';
import { Document } from './document.entity';

export enum EnvMode {
  BETA = 'BETA',
  PRODUCCION = 'PRODUCCION',
}

/**
 * ============================================================================
 * CCOFACT PRO - ENTIDAD EMPRESA EMISORA (MULTI-TENANT)
 * CORPORACIÓN CCOPLEX
 * ============================================================================
 * Representa a cada empresa emisora registrada en CCOFACT.
 * Cada empresa cuenta con:
 * - Aislamiento de datos y comprobantes
 * - Clave API única (x-api-key) para consumir los endpoints REST
 * - Credenciales SOL secundarias para el canal SOAP con SUNAT
 * - Certificado Digital X.509 (.pfx) cifrado para la firma digital UBL 2.1
 * - Entorno de trabajo (BETA o PRODUCCIÓN)
 * - URL de Webhook para notificaciones asíncronas de estado SUNAT
 */
@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 11 })
  ruc: string;

  @Column({ type: 'varchar', length: 255 })
  razon_social: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nombre_comercial: string;

  @Column({ type: 'varchar', length: 255 })
  direccion: string;

  @Column({ type: 'varchar', length: 6, default: '150101' })
  ubigeo: string;

  @Column({ type: 'varchar', length: 100, default: 'LIMA' })
  departamento: string;

  @Column({ type: 'varchar', length: 100, default: 'LIMA' })
  provincia: string;

  @Column({ type: 'varchar', length: 100, default: 'LIMA' })
  distrito: string;

  @Column({ type: 'varchar', length: 100, nullable: true, default: '-' })
  urbanizacion: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  telefono: string;

  @Column({ type: 'text', nullable: true })
  logo_url: string;

  @Column({ type: 'varchar', length: 100, default: 'MODDATOS' })
  sol_user: string;

  @Column({ type: 'varchar', length: 100, default: 'moddatos' })
  sol_pass: string;

  @Column({ type: 'text', nullable: true })
  certificate_pfx_base64: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  certificate_password: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  certificate_filename: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  certificate_url: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  certificate_expires_at: Date;

  @Column({ type: 'text', nullable: true })
  certificate_subject: string;

  @Column({ type: 'text', nullable: true })
  certificate_issuer: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'BETA',
  })
  env_mode: 'BETA' | 'PRODUCCION';

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  api_key: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  webhook_url: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @OneToMany(() => Branch, (b) => b.company)
  branches: Branch[];

  @OneToMany(() => Series, (s) => s.company)
  series_list: Series[];

  @OneToMany(() => Document, (d) => d.company)
  documents: Document[];

  // Getters auxiliares para interoperabilidad de nombres
  get legal_name(): string {
    return this.razon_social;
  }
  get commercial_name(): string {
    return this.nombre_comercial || this.razon_social;
  }
  get fiscal_address(): string {
    return this.direccion;
  }
}
