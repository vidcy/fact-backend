/**
 * ============================================================================
 * CCOFACT PRO - SCRIPT DE PURGA Y REINICIO LIMPIO: BOLETA B001-00000021
 * ============================================================================
 * Purgar completamente registros de B001 >= 21 en la base de datos de facturación
 * y calibrar la serie B001 a current_number = 20 para emitir B001-00000021 limpia.
 */

const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

// Cargar .env de fact-backend si existe
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.substring(0, idx).trim();
      let val = trimmed.substring(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  });
}

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:vidcy@localhost:5432/fact?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  console.log('================================================================');
  console.log('🧹 CCOFACT PRO: PURGA TOTAL DE BOLETA B001-00000021');
  console.log('================================================================');
  console.log(`📡 Conectando a Base de Datos: ${dbUrl.replace(/:[^:@]+@/, ':****@')}\n`);

  // 1. Buscar documentos B001 >= 21
  const factDocs = await prisma.$queryRawUnsafe(
    `SELECT id, full_number, number FROM documents 
     WHERE UPPER(series) = 'B001' AND number >= 21`
  );

  console.log(`🔍 Documentos encontrados con serie B001 y correlativo >= 21: ${(factDocs || []).length}`);

  if (factDocs && factDocs.length > 0) {
    for (const doc of factDocs) {
      console.log(`   👉 Eliminando comprobante ${doc.full_number} (ID: ${doc.id})...`);
      await prisma.$executeRawUnsafe(`DELETE FROM invoice_jobs WHERE document_id = $1::uuid`, doc.id);
      await prisma.$executeRawUnsafe(`DELETE FROM document_items WHERE document_id = $1::uuid`, doc.id);
      await prisma.$executeRawUnsafe(`DELETE FROM documents WHERE id = $1::uuid`, doc.id);
      console.log(`      ✅ ${doc.full_number} eliminado limpiamente.`);
    }
  }

  // 2. Calibrar serie B001 a correlativo 20
  const seriesRows = await prisma.$queryRawUnsafe(
    `SELECT id, current_number FROM series 
     WHERE UPPER(series) = 'B001' AND document_type = '03'`
  );

  if (seriesRows && seriesRows.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE series 
       SET current_number = 20, updated_at = NOW() 
       WHERE UPPER(series) = 'B001' AND document_type = '03'`
    );
    console.log(`⚙️  Serie B001 (03) actualizada a current_number = 20.`);
  } else {
    const companies = await prisma.$queryRawUnsafe(`SELECT id FROM companies LIMIT 1`);
    if (companies && companies.length > 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO series (id, company_id, document_type, series, current_number, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, '03', 'B001', 20, true, NOW(), NOW())`,
        companies[0].id
      );
      console.log(`⚙️  Serie B001 (03) inicializada en current_number = 20.`);
    }
  }

  // 3. Confirmación
  const check = await prisma.$queryRawUnsafe(
    `SELECT current_number FROM series WHERE UPPER(series) = 'B001' AND document_type = '03' LIMIT 1`
  );
  const currentNum = check && check.length > 0 ? check[0].current_number : 20;
  const nextNum = Number(currentNum) + 1;
  const nextFull = `B001-${String(nextNum).padStart(8, '0')}`;

  console.log('\n================================================================');
  console.log(`✨ SECUENCIA CALIBRADA EXITOSAMENTE.`);
  console.log(`🎯 Próximo Comprobante que generará CCOFACT PRO: ${nextFull}`);
  console.log('================================================================\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('❌ Error en script de purga:', e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
