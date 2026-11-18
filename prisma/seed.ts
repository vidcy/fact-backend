import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Iniciando proceso de Seed para CCOFACT PRO (SUNAT UBL 2.1)...');

  // 1. Asegurar extensión UUID en PostgreSQL
  try {
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    console.log('✅ Extensión uuid-ossp habilitada en PostgreSQL.');
  } catch (err: any) {
    console.warn('⚠️  Nota sobre extensión uuid-ossp:', err.message);
  }

  // 2. Cargar datos de la empresa desde JSON
  const dataPath = path.join(__dirname, 'company_data.json');
  let companyData: any = null;

  if (fs.existsSync(dataPath)) {
    const raw = fs.readFileSync(dataPath, 'utf8');
    companyData = JSON.parse(raw);
    console.log('📁 Datos cargados desde prisma/company_data.json');
  }

  if (!companyData || !companyData.comp) {
    throw new Error('No se encontró el archivo de datos prisma/company_data.json');
  }

  const { comp, series } = companyData;

  // 3. Upsert de la Empresa Emisora
  console.log(`🏢 Provisionando empresa emisor RUC: ${comp.ruc} (${comp.razonSocial})...`);
  const company = await prisma.company.upsert({
    where: { ruc: comp.ruc },
    update: {
      razonSocial: comp.razonSocial,
      nombreComercial: comp.nombreComercial,
      direccion: comp.direccion,
      ubigeo: comp.ubigeo,
      departamento: comp.departamento,
      provincia: comp.provincia,
      distrito: comp.distrito,
      urbanizacion: comp.urbanizacion || '-',
      solUser: comp.solUser,
      solPass: comp.solPass,
      certificatePfxBase64: comp.certificatePfxBase64,
      certificatePassword: comp.certificatePassword,
      certificateFilename: comp.certificateFilename,
      certificateUrl: comp.certificateUrl,
      certificateExpiresAt: comp.certificateExpiresAt ? new Date(comp.certificateExpiresAt) : null,
      certificateSubject: comp.certificateSubject,
      certificateIssuer: comp.certificateIssuer,
      envMode: comp.envMode || 'PRODUCCION',
      apiKey: comp.apiKey,
      isActive: true,
      updatedAt: new Date(),
    },
    create: {
      id: comp.id,
      ruc: comp.ruc,
      razonSocial: comp.razonSocial,
      nombreComercial: comp.nombreComercial,
      direccion: comp.direccion,
      ubigeo: comp.ubigeo,
      departamento: comp.departamento,
      provincia: comp.provincia,
      distrito: comp.distrito,
      urbanizacion: comp.urbanizacion || '-',
      solUser: comp.solUser,
      solPass: comp.solPass,
      certificatePfxBase64: comp.certificatePfxBase64,
      certificatePassword: comp.certificatePassword,
      certificateFilename: comp.certificateFilename,
      certificateUrl: comp.certificateUrl,
      certificateExpiresAt: comp.certificateExpiresAt ? new Date(comp.certificateExpiresAt) : null,
      certificateSubject: comp.certificateSubject,
      certificateIssuer: comp.certificateIssuer,
      envMode: comp.envMode || 'PRODUCCION',
      apiKey: comp.apiKey,
      isActive: true,
    },
  });

  console.log(`✅ Empresa ${company.ruc} sincronizada con ID: ${company.id}`);

  // 4. Provisionar Sucursal Principal (0000)
  let defaultBranch = await prisma.branch.findFirst({
    where: {
      companyId: company.id,
      code: '0000',
    },
  });

  if (defaultBranch) {
    defaultBranch = await prisma.branch.update({
      where: { id: defaultBranch.id },
      data: {
        name: 'Sede Principal',
        address: company.direccion,
        ubigeo: company.ubigeo,
        isActive: true,
      },
    });
  } else {
    defaultBranch = await prisma.branch.create({
      data: {
        companyId: company.id,
        code: '0000',
        name: 'Sede Principal',
        address: company.direccion,
        ubigeo: company.ubigeo,
        isActive: true,
      },
    });
  }
  console.log(`✅ Sucursal Principal (${defaultBranch.code}) vinculada.`);

  // 5. Provisionar Series Oficiales SUNAT
  console.log('🔢 Sincronizando Series Oficiales SUNAT...');
  const seriesToSeed = series && series.length > 0 ? series : [
    { documentType: '01', series: 'F001', currentNumber: 0 },
    { documentType: '03', series: 'B001', currentNumber: 18 },
    { documentType: '07', series: 'FC01', currentNumber: 0 },
    { documentType: '07', series: 'BC01', currentNumber: 5 },
    { documentType: '08', series: 'FD01', currentNumber: 0 },
    { documentType: '08', series: 'BD01', currentNumber: 0 },
  ];

  for (const s of seriesToSeed) {
    const existing = await prisma.series.findFirst({
      where: {
        companyId: company.id,
        documentType: s.documentType,
        series: s.series,
      },
    });

    if (existing) {
      // Actualizar preservando o sincronizando el correlativo más alto
      const targetNumber = Math.max(existing.currentNumber, s.currentNumber);
      await prisma.series.update({
        where: { id: existing.id },
        data: {
          currentNumber: targetNumber,
          branchId: defaultBranch.id,
          isActive: true,
          updatedAt: new Date(),
        },
      });
      console.log(`   📌 Serie ${s.series} (Tipo ${s.documentType}): Correlativo actual = ${targetNumber}`);
    } else {
      await prisma.series.create({
        data: {
          companyId: company.id,
          branchId: defaultBranch.id,
          documentType: s.documentType,
          series: s.series,
          currentNumber: s.currentNumber,
          isActive: true,
        },
      });
      console.log(`   ✨ Serie ${s.series} (Tipo ${s.documentType}) CREADA: Correlativo inicial = ${s.currentNumber}`);
    }
  }

  console.log('\n=============================================================');
  console.log('🎉 PROCESO DE SEED COMPLETADO CON ÉXITO');
  console.log('=============================================================');
  console.log(`Emisor Fiscal:     ${company.razonSocial}`);
  console.log(`RUC:               ${company.ruc}`);
  console.log(`Entorno SUNAT:     ${company.envMode}`);
  console.log(`API Key (x-api-key): ${company.apiKey}`);
  console.log(`Certificado Nube:  ${company.certificateUrl || 'En base de datos'}`);
  console.log('=============================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Error durante la ejecución del seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
