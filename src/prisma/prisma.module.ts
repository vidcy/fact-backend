import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * ============================================================================
 * CCOFACT PRO - MÓDULO GLOBAL PRISMA ORM
 * ============================================================================
 * Marcado con @Global() para que PrismaService esté disponible de manera
 * inmediata en todos los módulos (Series, Documents, Queue, Companies)
 * sin necesidad de volver a importarlo en cada uno.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
