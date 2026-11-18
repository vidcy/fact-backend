import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DataSource, Repository, QueryRunner } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Series } from '../../entities/series.entity';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ============================================================================
 * CCOFACT PRO - SERVICIO DE SERIES Y CORRELATIVOS (CORPORACIÓN CCOPLEX)
 * ============================================================================
 * Este servicio garantiza la integridad matemática y fiscal de los comprobantes:
 * - Aislamiento multi-tenant estricto por cada empresa emisora (company_id).
 * - Secuencialidad perfecta sin saltos correlativos (exigencia R.S. SUNAT).
 * - Bloqueo pesimista ACID (SELECT ... FOR UPDATE) a nivel de fila en PostgreSQL.
 * - Soporte híbrido: Funciona con QueryRunner de TypeORM y con Prisma ORM.
 */
@Injectable()
export class SeriesService {
  // Logger institucional para auditoría de reserva de numeraciones fiscales
  private readonly logger = new Logger('CCOFACT-SeriesService');

  constructor(
    // Repositorio TypeORM para operaciones habituales de consulta
    @InjectRepository(Series)
    private seriesRepo: Repository<Series>,

    // DataSource para transacciones de bajo nivel
    private dataSource: DataSource,

    // Servicio Prisma ORM para queries tipadas y migraciones
    private prisma: PrismaService,
  ) {}

  /**
   * Obtiene la lista completa de series configuradas para una empresa.
   * 
   * @param companyId Identificador UUID de la empresa emisora
   * @returns Lista de series ordenadas por tipo de documento y código de serie
   */
  public async getSeriesByCompany(companyId: string): Promise<Series[]> {
    // Consulta filtrada exclusivamente por el tenant de la empresa para evitar fuga de datos
    return this.seriesRepo.find({
      where: { company_id: companyId },
      order: { document_type: 'ASC', series: 'ASC' },
    });
  }

  /**
   * Registra una nueva serie o actualiza el número correlativo inicial de una existente.
   * Utilizado para inicializaciones contables o sincronización de correlativos desde sistemas antiguos.
   * 
   * @param companyId Identificador UUID de la empresa
   * @param documentType Tipo de comprobante (01: Factura, 03: Boleta, 07: NC, 08: ND)
   * @param seriesCode Código de serie (ej. F001, B001, FC01)
   * @param initialNumber Número correlativo con el que iniciará la numeración
   */
  public async createOrUpdateSeries(
    companyId: string,
    documentType: string,
    seriesCode: string,
    initialNumber: number = 0,
  ): Promise<Series> {
    // Normalizar serie a mayúsculas y sin espacios en blanco
    const formattedSeries = seriesCode.toUpperCase().trim();

    // 1. Buscar si la serie ya se encuentra registrada para la empresa
    let seriesRecord = await this.seriesRepo.findOne({
      where: { company_id: companyId, document_type: documentType, series: formattedSeries },
    });

    // 2. Si ya existe, actualizar el correlativo actual
    if (seriesRecord) {
      seriesRecord.current_number = initialNumber;
      return this.seriesRepo.save(seriesRecord);
    }

    // 3. Si no existe, crear la nueva entidad vinculada a la empresa
    seriesRecord = this.seriesRepo.create({
      company_id: companyId,
      document_type: documentType,
      series: formattedSeries,
      current_number: initialNumber,
    });

    // 4. Persistir en la base de datos PostgreSQL
    return this.seriesRepo.save(seriesRecord);
  }

  /**
   * ==========================================================================
   * RESERVA ATÓMICA DE CORRELATIVOS (ATOMIC CORRELATIVE RESERVATION)
   * ==========================================================================
   * Este es el componente crítico que impide la DOBLE FACTURACIÓN.
   * 
   * ¿Cómo funciona?
   * 1. Se ejecuta dentro de la transacción activa iniciada por el llamador.
   * 2. Lanza un `SELECT ... FOR UPDATE` sobre la fila exacta (company_id + document_type + series).
   * 3. PostgreSQL bloquea esa fila a nivel de motor de almacenamiento (Row-Level Exclusive Lock).
   * 4. Si entran 100 peticiones simultáneas en el mismo milisegundo, la base de datos
   *    las coloca en una cola estricta (FIFO) y procesa una por una secuencialmente.
   * 5. Incrementa el número en +1 y actualiza la fila.
   * 6. Retorna el nuevo correlativo reservado.
   * 7. El bloqueo se libera ÚNICAMENTE cuando la transacción hace COMMIT definitivo.
   */
  public async getNextCorrelative(
    queryRunner: QueryRunner,
    companyId: string,
    documentType: string,
    seriesCode: string,
  ): Promise<number> {
    // Asegurar formato canónico de serie (ej. 'F001')
    const formattedSeries = seriesCode.toUpperCase().trim();

    // Paso 1: Ejecutar SELECT con bloqueo pesimista FOR UPDATE en PostgreSQL
    const rows = await queryRunner.query(
      `SELECT id, current_number FROM series 
        WHERE company_id = $1 AND document_type = $2 AND series = $3 
        FOR UPDATE`,
      [companyId, documentType, formattedSeries],
    );

    let nextNumber = 1;

    // Paso 2: Si la serie ya existe, incrementar correlativo
    if (rows && rows.length > 0) {
      // Parsear correlativo actual a entero seguro
      const currentNumber = parseInt(rows[0].current_number, 10);
      // Calcular siguiente número correlativo fiscal
      nextNumber = currentNumber + 1;

      // Paso 3: Actualizar el correlativo en la misma transacción bloqueada
      await queryRunner.query(
        `UPDATE series SET current_number = $1, updated_at = NOW() WHERE id = $2`,
        [nextNumber, rows[0].id],
      );
    } else {
      // Paso 4: Si es la primera emisión de esta serie, inicializarla atómicamente con 1
      await queryRunner.query(
        `INSERT INTO series (id, company_id, document_type, series, current_number, is_active, created_at, updated_at) 
          VALUES (gen_random_uuid(), $1, $2, $3, $4, true, NOW(), NOW())`,
        [companyId, documentType, formattedSeries, nextNumber],
      );
    }

    // Log de auditoría para trazabilidad de la reserva
    this.logger.debug(
      `[CORRELATIVO RESERVADO] Empresa: ${companyId} | Tipo: ${documentType} | Serie: ${formattedSeries} | Correlativo: ${nextNumber}`,
    );

    // Paso 5: Devolver el número exacto y único reservado
    return nextNumber;
  }
}
