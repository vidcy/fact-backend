import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * ============================================================================
 * CCOFACT PRO - SERVICIO DE CONEXIÓN PRISMA ORM (CORPORACIÓN CCOPLEX)
 * ============================================================================
 * Maneja el ciclo de vida de la conexión a la base de datos PostgreSQL 18
 * a través de Prisma Client, permitiendo transacciones atómicas interactivas,
 * queries tipadas y soporte para bloqueo pesimista mediante $queryRaw.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Logger institucional para trazabilidad del estado de conexión
  private readonly logger = new Logger('CCOFACT-PrismaService');

  constructor() {
    // Configuración de logs de Prisma para auditoría de consultas críticas y errores
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  /**
   * Se ejecuta automáticamente al arrancar la aplicación NestJS.
   * Establece el pool de conexiones hacia PostgreSQL 18.
   */
  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Conexión con PostgreSQL 18 establecida exitosamente mediante Prisma ORM.');
    } catch (error: any) {
      this.logger.error('Error crítico al conectar Prisma con la base de datos PostgreSQL:', error.message);
      throw error;
    }
  }

  /**
   * Se ejecuta al apagar ordenadamente el servidor NestJS.
   * Cierra todas las conexiones activas en el pool para evitar fugas de recursos.
   */
  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Pool de conexiones de Prisma cerrado correctamente.');
  }
}
