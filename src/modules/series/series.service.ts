import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Series } from '@prisma/client';

/**
 * ============================================================================
 * CCOFACT PRO - SERVICIO DE SERIES Y CORRELATIVOS (100% PRISMA ORM)
 * CORPORACIÓN CCOPLEX
 * ============================================================================
 * Este servicio garantiza la integridad matemática y fiscal de los comprobantes:
 * - Aislamiento multi-tenant estricto por cada empresa emisora (company_id).
 * - Secuencialidad perfecta sin saltos correlativos (exigencia R.S. SUNAT).
 * - Bloqueo pesimista ACID (SELECT ... FOR UPDATE) a nivel de fila en PostgreSQL.
 */
@Injectable()
export class SeriesService {
  private readonly logger = new Logger('CCOFACT-SeriesService');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene la lista completa de series configuradas para una empresa.
   */
  public async getSeriesByCompany(companyId: string): Promise<Series[]> {
    return this.prisma.series.findMany({
      where: { company_id: companyId },
      orderBy: [{ document_type: 'asc' }, { series: 'asc' }],
    });
  }

  /**
   * Registra una nueva serie o actualiza el número correlativo inicial de una existente.
   */
  public async createOrUpdateSeries(
    companyId: string,
    documentType: string,
    seriesCode: string,
    initialNumber: number = 0,
  ): Promise<Series> {
    const formattedSeries = seriesCode.toUpperCase().trim();

    return this.prisma.series.upsert({
      where: {
        company_id_document_type_series: {
          company_id: companyId,
          document_type: documentType,
          series: formattedSeries,
        },
      },
      update: {
        current_number: initialNumber,
        is_active: true,
      },
      create: {
        company_id: companyId,
        document_type: documentType,
        series: formattedSeries,
        current_number: initialNumber,
        is_active: true,
      },
    });
  }

  /**
   * Inicializa las series obligatorias para una nueva empresa emisora.
   */
  public async initDefaultSeries(companyId: string): Promise<void> {
    const defaults = [
      { type: '01', series: 'F001' },
      { type: '03', series: 'B001' },
      { type: '07', series: 'FC01' },
      { type: '07', series: 'BC01' },
      { type: '08', series: 'FD01' },
      { type: '08', series: 'BD01' },
      { type: '09', series: 'T001' },
    ];
    for (const d of defaults) {
      await this.createOrUpdateSeries(companyId, d.type, d.series, 0);
    }
  }

  /**
   * ==========================================================================
   * RESERVA ATÓMICA DE CORRELATIVOS (ATOMIC CORRELATIVE RESERVATION)
   * ==========================================================================
   * Ejecuta un SELECT ... FOR UPDATE en PostgreSQL dentro de la transacción de Prisma.
   * PostgreSQL bloquea esa fila a nivel de motor (Row-Level Exclusive Lock)
   * garantizando cero saltos de correlativo y cero doble facturación.
   */
  public async getNextCorrelative(
    tx: any,
    companyId: string,
    documentType: string,
    seriesCode: string,
  ): Promise<number> {
    const client = tx || this.prisma;
    const formattedSeries = seriesCode.toUpperCase().trim();

    // 1. Bloqueo pesimista a nivel de fila en la tabla series
    const rows = await client.$queryRawUnsafe(
      `SELECT id, current_number FROM series 
        WHERE company_id = $1::uuid AND document_type = $2 AND series = $3 
        FOR UPDATE`,
      companyId,
      documentType,
      formattedSeries,
    );

    let currentSeriesNumber = 0;
    let seriesId: string | null = null;

    if (rows && (rows as any[]).length > 0) {
      currentSeriesNumber = parseInt((rows as any[])[0].current_number, 10) || 0;
      seriesId = (rows as any[])[0].id;
    }

    // 2. Safety Floor Anti-Colisión: comprobar el número más alto existente en la tabla documents
    const maxDocRows = await client.$queryRawUnsafe(
      `SELECT COALESCE(MAX(number), 0) as max_num FROM documents 
        WHERE company_id = $1::uuid AND document_type = $2 AND series = $3`,
      companyId,
      documentType,
      formattedSeries,
    );

    const maxDocNumber =
      maxDocRows && (maxDocRows as any[]).length > 0
        ? parseInt((maxDocRows as any[])[0].max_num, 10) || 0
        : 0;

    // El correlativo debe ser estrictamente superior al mayor registrado en series y en documents
    const nextNumber = Math.max(currentSeriesNumber, maxDocNumber) + 1;

    if (seriesId) {
      await client.$executeRawUnsafe(
        `UPDATE series SET current_number = $1, updated_at = NOW() WHERE id = $2::uuid`,
        nextNumber,
        seriesId,
      );
    } else {
      await client.$executeRawUnsafe(
        `INSERT INTO series (id, company_id, document_type, series, current_number, is_active, created_at, updated_at) 
          VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, true, NOW(), NOW())`,
        companyId,
        documentType,
        formattedSeries,
        nextNumber,
      );
    }

    this.logger.log(
      `[CORRELATIVO RESERVADO ATÓMICO] Empresa: ${companyId} | Tipo: ${documentType} | Serie: ${formattedSeries} | Correlativo: ${nextNumber} (Piso documentos: ${maxDocNumber})`,
    );

    return nextNumber;
  }
}
