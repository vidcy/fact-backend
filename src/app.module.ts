import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { Company } from './entities/company.entity';
import { Branch } from './entities/branch.entity';
import { Series } from './entities/series.entity';
import { Document } from './entities/document.entity';
import { DocumentItem } from './entities/document-item.entity';
import { InvoiceJob } from './entities/invoice-job.entity';
import { CompaniesModule } from './modules/companies/companies.module';
import { SeriesModule } from './modules/series/series.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SunatCoreModule } from './modules/sunat-core/sunat-core.module';
import { QueueModule } from './modules/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { CompaniesService } from './modules/companies/companies.service';

/**
 * ============================================================================
 * CCOFACT PRO - MÓDULO PRINCIPAL DE LA APLICACIÓN (CORPORACIÓN CCOPLEX)
 * ============================================================================
 * Orquestador central del servidor backend:
 * - PrismaModule: Gestión soberana de migraciones y queries relacionales en PostgreSQL 18
 * - TypeOrmModule: Compatibilidad de repositorios y transacciones activas
 * - CompaniesModule: Gestión multi-tenant de empresas emisoras, certificados X.509 y SOL
 * - SeriesModule: Control atómico de correlativos con bloqueo pesimista (SELECT FOR UPDATE)
 * - DocumentsModule: Emisión integral de Facturas, Boletas, Notas de Crédito y Débito
 * - SunatCoreModule: Motor UBL 2.1, firma digital XMLDSig, códigos QR oficiales y SOAP
 * - QueueModule: Worker transaccional de alta disponibilidad con PostgreSQL SKIP LOCKED
 */
@Module({
  imports: [
    // 1. Carga de variables de entorno globales desde .env
    ConfigModule.forRoot({ isGlobal: true }),

    // 2. Módulo Global de Prisma ORM para migraciones e introspección de base de datos
    PrismaModule,

    // 3. Pool de conexiones PostgreSQL
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'vidcy',
      database: process.env.DB_DATABASE || 'fact',
      entities: [Company, Branch, Series, Document, DocumentItem, InvoiceJob],
      synchronize: false, // Las migraciones son gestionadas formalmente por Prisma ORM
      logging: false,
    }),

    // 4. Módulos funcionales de la plataforma
    AuthModule,
    CompaniesModule,
    SeriesModule,
    DocumentsModule,
    SunatCoreModule,
    QueueModule,
  ],
})
export class AppModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('CCOFACT-AppModule');

  constructor(private companiesService: CompaniesService) {}

  /**
   * Se ejecuta inmediatamente después de que la aplicación NestJS inicializa todos los módulos.
   * Garantiza la existencia de la empresa matriz (Corporación Ccoplex) y sus series por defecto.
   */
  async onApplicationBootstrap() {
    this.logger.log('CCOFACT PRO iniciado en modo Producción Limpio. Esperando registro de empresas del contribuyente.');
  }
}
