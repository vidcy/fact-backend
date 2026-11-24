import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * ============================================================================
 * CCOFACT PRO - CONFIGURACIÓN OFICIAL DE PRISMA ORM (PRISMA 7 / PRISMA 8 READY)
 * ============================================================================
 * Archivo moderno de configuración que sustituye package.json#prisma.
 * Carga las variables de entorno de .env y define el esquema y seed oficial.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});
