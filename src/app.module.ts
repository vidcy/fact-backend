import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { SeriesModule } from './modules/series/series.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SunatCoreModule } from './modules/sunat-core/sunat-core.module';
import { QueueModule } from './modules/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ConsultasModule } from './modules/consultas/consultas.module';

/**
 * ============================================================================
 * CCOFACT PRO - MÓDULO PRINCIPAL DE LA APLICACIÓN (CORPORACIÓN CCOPLEX)
 * 100% PRISMA ORM - ZERO TYPEORM
 * ============================================================================
 * Orquestador central del servidor backend:
 * - PrismaModule: Gestión soberana de migraciones, transacciones ACID y queries relacionales en PostgreSQL
 * - AuthModule: Autenticación segura de administradores (JWT + Argon2)
 * - UsersModule: Gestión multi-tenant de usuarios y accesos (RBAC)
 * - CompaniesModule: Gestión multi-tenant de empresas emisoras, certificados X.509 y SOL
 * - SeriesModule: Control atómico de correlativos con bloqueo pesimista (SELECT ... FOR UPDATE)
 * - DocumentsModule: Emisión integral de Facturas, Boletas, Notas de Crédito y Débito
 * - SunatCoreModule: Motor UBL 2.1, firma digital XMLDSig, códigos QR oficiales y SOAP
 * - QueueModule: Worker transaccional de alta disponibilidad con PostgreSQL SKIP LOCKED
 */
@Module({
  imports: [
    // 1. Carga de variables de entorno globales desde .env
    ConfigModule.forRoot({ isGlobal: true }),

    // 2. Módulo Global de Prisma ORM
    PrismaModule,

    // 3. Módulos funcionales de la plataforma
    AuthModule,
    UsersModule,
    CompaniesModule,
    SeriesModule,
    DocumentsModule,
    SunatCoreModule,
    QueueModule,
    ConsultasModule,
  ],
})
export class AppModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('CCOFACT-AppModule');

  /**
   * Se ejecuta inmediatamente después de que la aplicación NestJS inicializa todos los módulos.
   */
  async onApplicationBootstrap() {
    this.logger.log('CCOFACT PRO iniciado en modo Producción Limpio (100% Prisma ORM).');
  }
}
