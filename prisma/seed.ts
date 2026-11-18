import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

/**
 * Hashea una contraseña usando scrypt con salt criptográfico de 16 bytes
 */
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  console.log('=============================================================');
  console.log('🚀 CCOFACT PRO - INICIALIZACIÓN SOBERANA DE BASE DE DATOS');
  console.log('=============================================================');

  // 1. Verificar conexión a la base de datos PostgreSQL
  try {
    await prisma.$queryRaw`SELECT 1;`;
    console.log('✅ Conexión establecida con la base de datos PostgreSQL.');
  } catch (connErr: any) {
    console.error('\n❌ ERROR DE CONEXIÓN A POSTGRESQL:');
    console.error('   No se pudo conectar a la base de datos en la URL configurada.');
    console.error('   Asegúrate de que el servicio de PostgreSQL esté iniciado y accesible.');
    console.error(`   Detalle: ${connErr.message}\n`);
    throw connErr;
  }

  // 2. Asegurar extensión UUID y tabla de usuarios en PostgreSQL
  try {
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    console.log('✅ Extensión uuid-ossp verificada.');
  } catch (err: any) {
    console.warn('⚠️  Nota sobre extensión uuid-ossp:', err.message);
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(150) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(150) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'SUPER_ADMIN',
        company_id UUID,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
      );
    `);
    // Asegurar columna company_id si la tabla existía previamente
    await prisma.$executeRawUnsafe('ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id UUID;');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "IDX_users_company_id" ON users (company_id);');
    console.log('✅ Tabla "users" y columna "company_id" verificadas y listas.');
  } catch (tableErr: any) {
    console.warn('⚠️  Nota sobre verificación de tabla users:', tableErr.message);
  }

  // 3. Parámetros del Administrador Maestro (desde .env o predeterminados)
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@ccoplex.com').trim().toLowerCase();
  const adminPassword = (process.env.ADMIN_PASSWORD || 'admin123').trim();
  const adminName = process.env.ADMIN_NAME || 'Administrador Maestro Ccoplex';

  console.log(`👤 Provisionando Usuario Administrador Maestro: ${adminEmail}...`);

  const passwordHash = hashPassword(adminPassword);

  // 4. Upsert seguro del usuario Administrador
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: adminName,
      password_hash: passwordHash,
      role: 'SUPER_ADMIN',
      company_id: null,
      is_active: true,
      updated_at: new Date(),
    },
    create: {
      email: adminEmail,
      name: adminName,
      password_hash: passwordHash,
      role: 'SUPER_ADMIN',
      company_id: null,
      is_active: true,
    },
  });

  console.log('\n=============================================================');
  console.log('🎉 BASE DE DATOS INICIALIZADA CON ÉXITO');
  console.log('=============================================================');
  console.log(`Usuario Administrador: ${adminUser.email}`);
  console.log(`Nombre:                ${adminUser.name}`);
  console.log(`Rol Asignado:          ${adminUser.role}`);
  console.log(`Estado:                ${adminUser.is_active ? 'ACTIVO' : 'INACTIVO'}`);
  console.log('=============================================================');
  console.log('💡 La base de datos contiene exclusivamente el usuario maestro.');
  console.log('   Las empresas emisoras, certificados y series se configuran');
  console.log('   directamente desde el Panel Web de Facturación.');
  console.log('=============================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Error durante la ejecución del seed:', e.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
