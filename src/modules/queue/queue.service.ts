import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { InvoiceJob, JobType, JobStatus } from '../../entities/invoice-job.entity';
import { Document, DocumentStatus } from '../../entities/document.entity';
import { Company } from '../../entities/company.entity';
import { SunatSoapService } from '../sunat-core/services/sunat-soap.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ============================================================================
 * CCOFACT PRO - SERVICIO DE COLAS TRANSACCIONALES (CORPORACIÓN CCOPLEX)
 * ============================================================================
 * Arquitectura de Procesamiento Asíncrono de Alta Disponibilidad:
 * - Emplea el comando `FOR UPDATE SKIP LOCKED` nativo de PostgreSQL 18.
 * - Elimina la necesidad de infraestructura pesada como Redis o RabbitMQ en etapas iniciales.
 * - Permite escalabilidad horizontal: 10 servidores backend pueden consultar la tabla
 *   al mismo tiempo y NUNCA competirán ni procesarán el mismo comprobante dos veces.
 * - Reintentos con algoritmo de retroceso exponencial (Exponential Backoff):
 *   Intento 1: +15 seg | Intento 2: +1 min | Intento 3: +5 min | Intento 4: +15 min | Intento 5: +1 hora
 * - Despacho de Webhooks HTTP para notificar instantáneamente a sistemas externos (ERP/POS).
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  // Logger institucional para trazabilidad del worker de segundo plano
  private readonly logger = new Logger('CCOFACT-QueueWorker');
  
  // Timer de sondeo recurrente
  private workerInterval: NodeJS.Timeout | null = null;
  
  // Flag de control para evitar solapamiento dentro de la misma instancia
  private isProcessing = false;

  constructor(
    // Repositorio de trabajos en cola
    @InjectRepository(InvoiceJob)
    private jobRepo: Repository<InvoiceJob>,

    // Repositorio de comprobantes emitidos
    @InjectRepository(Document)
    private docRepo: Repository<Document>,

    // Repositorio de empresas emisoras
    @InjectRepository(Company)
    private companyRepo: Repository<Company>,

    // DataSource para transacciones y queries de bajo nivel
    private dataSource: DataSource,

    // Cliente SOAP para entrega a SUNAT
    private sunatSoap: SunatSoapService,

    // Servicio Prisma ORM para queries relacionales y migraciones
    private prisma: PrismaService,
  ) {}

  /**
   * Ciclo de vida: Inicia el worker al arrancar el backend NestJS.
   * Ejecuta el sondeo de colas cada 4 segundos.
   */
  onModuleInit() {
    this.logger.log('Iniciando Worker de Colas Transaccionales (PostgreSQL SKIP LOCKED)...');
    this.workerInterval = setInterval(() => {
      this.processNextJobs().catch((err) => {
        this.logger.error('Error en ciclo del worker de colas:', err.message);
      });
    }, 4000);
  }

  /**
   * Ciclo de vida: Detiene limpiamente el intervalo al apagar el servidor.
   */
  onModuleDestroy() {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
      this.logger.log('Worker de colas transaccionales detenido correctamente.');
    }
  }

  /**
   * Procesa el lote de trabajos pendientes respetando SKIP LOCKED.
   */
  public async processNextJobs() {
    // Si ya hay un lote en proceso en este hilo, esperar al siguiente ciclo
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Obtener conexión dedicada del pool de PostgreSQL
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // Iniciar transacción de bloqueo
      await queryRunner.startTransaction();

      // CONSULTA CLAVE: Bloquea hasta 5 trabajos pendientes cuya fecha de ejecución haya vencido
      // SKIP LOCKED ignora las filas bloqueadas por otros trabajadores o servidores réplica
      const rawJobs = await queryRunner.query(
        `SELECT id FROM invoice_jobs 
         WHERE status = $1 AND next_run_at <= NOW()
         ORDER BY next_run_at ASC 
         LIMIT 5 
         FOR UPDATE SKIP LOCKED`,
        [JobStatus.PENDING],
      );

      // Si no hay trabajos pendientes listos para ejecutar, liberar transacción
      if (!rawJobs || rawJobs.length === 0) {
        await queryRunner.rollbackTransaction();
        return;
      }

      // Extraer los IDs bloqueados con éxito
      const jobIds = rawJobs.map((r: any) => r.id);

      // Marcar los trabajos como PROCESSING de inmediato para que ningún otro worker los toque
      await queryRunner.query(
        `UPDATE invoice_jobs 
         SET status = $1, locked_at = NOW(), locked_by = $2, updated_at = NOW() 
         WHERE id = ANY($3)`,
        [JobStatus.PROCESSING, 'worker_instance_1', jobIds],
      );

      // Confirmar la adquisición de los trabajos
      await queryRunner.commitTransaction();

      // Procesar cada trabajo adquirido de forma secuencial y controlada
      for (const jId of jobIds) {
        await this.executeJob(jId);
      }
    } catch (err: any) {
      this.logger.error('Error en adquisición de lote SKIP LOCKED:', err.message);
      try {
        await queryRunner.rollbackTransaction();
      } catch (rbErr) {}
    } finally {
      // Liberar la conexión hacia el pool
      await queryRunner.release();
      this.isProcessing = false;
    }
  }

  /**
   * Ejecución individual de un trabajo específico según su tipo.
   */
  private async executeJob(jobId: string) {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) return;

    try {
      this.logger.log(`[WORKER] Procesando trabajo: ${job.id} | Tipo: ${job.job_type} | Intento: ${job.attempts + 1}`);

      if (job.job_type === JobType.SEND_BILL) {
        // Enviar comprobante pendiente por SOAP a SUNAT
        await this.handleSendBillJob(job);
      } else if (job.job_type === JobType.DISPATCH_WEBHOOK) {
        // Notificar al sistema cliente (ERP / POS) mediante Webhook HTTP
        await this.handleDispatchWebhook(job);
      }

      // Marcar trabajo como completado con éxito
      job.status = JobStatus.COMPLETED;
      job.last_error = "";
      await this.jobRepo.save(job);
      this.logger.log(`[WORKER] Trabajo ${job.id} COMPLETADO con éxito.`);
    } catch (err: any) {
      // Manejo de fallos con retroceso exponencial
      job.attempts += 1;
      job.last_error = err.message || 'Error desconocido';

      if (job.attempts >= job.max_attempts) {
        // Superó el límite de reintentos: marcar como FAILED definitivo
        job.status = JobStatus.FAILED;
        this.logger.error(`[WORKER] Trabajo ${job.id} FALLÓ definitivamente tras ${job.attempts} intentos: ${err.message}`);
      } else {
        // Reintentar en el futuro: calcular backoff exponencial (15s, 1m, 5m, 15m, 1h)
        const delaySeconds = [15, 60, 300, 900, 3600][job.attempts - 1] || 3600;
        job.status = JobStatus.PENDING;
        job.next_run_at = new Date(Date.now() + delaySeconds * 1000);
        this.logger.warn(`[WORKER] Trabajo ${job.id} falló temporalmente. Reintento ${job.attempts}/${job.max_attempts} programado en ${delaySeconds}s.`);
      }

      await this.jobRepo.save(job);
    }
  }

  /**
   * Envío de comprobante por SOAP a SUNAT dentro del worker con resiliencia 0140
   */
  private async handleSendBillJob(job: InvoiceJob) {
    const doc = await this.docRepo.findOne({ where: { id: job.document_id } });
    if (!doc) throw new Error(`Comprobante con ID ${job.document_id} no encontrado en la base de datos`);

    const company = await this.companyRepo.findOne({ where: { id: job.company_id } });
    if (!company) throw new Error(`Empresa emisora con ID ${job.company_id} no encontrada`);

    // Si el comprobante ya tenía error 0140 (en proceso), consultamos directamente el CDR
    let sunatResult;
    if (doc.sunat_response_code?.includes('0140') || doc.sunat_description?.includes('0140')) {
      this.logger.log(`[WORKER] Comprobante ${doc.full_number} en estado 0140. Consultando CDR con getStatusCdr...`);
      sunatResult = await this.sunatSoap.getStatusCdr(
        company,
        doc.document_type,
        doc.series,
        doc.number,
      );
      if (!sunatResult.success && !sunatResult.cdrZipBase64 && !sunatResult.responseCode?.includes('0140')) {
        sunatResult = await this.sunatSoap.sendBill(doc, company, doc.xml_content);
      }
    } else {
      sunatResult = await this.sunatSoap.sendBill(doc, company, doc.xml_content);
      // Si el envío dio 0140 (SUNAT ya lo tenía en cola), consultamos si ya emitió el CDR
      if (sunatResult.responseCode?.includes('0140') || sunatResult.description?.includes('0140')) {
        this.logger.log(`[WORKER] Comprobante ${doc.full_number} retornó 0140. Consultando CDR con getStatusCdr...`);
        const cdrCheck = await this.sunatSoap.getStatusCdr(
          company,
          doc.document_type,
          doc.series,
          doc.number,
        );
        if (cdrCheck.success || cdrCheck.cdrZipBase64) {
          sunatResult = cdrCheck;
        }
      }
    }

    if (sunatResult.success) {
      // Comprobante aceptado por SUNAT: almacenar CDR y código de respuesta
      doc.status =
        sunatResult.notes && sunatResult.notes.length > 0
          ? DocumentStatus.ACCEPTED_OBSERVED
          : DocumentStatus.ACCEPTED;
      doc.sunat_response_code = sunatResult.responseCode;
      doc.sunat_description = sunatResult.description;
      doc.sunat_notes = sunatResult.notes || null;
      doc.cdr_xml = sunatResult.cdrXml || null;
      doc.cdr_zip_base64 = sunatResult.cdrZipBase64 || null;
      doc.sunat_response_at = new Date();
      await this.docRepo.save(doc);

      // Si la empresa tiene webhook configurado, programar notificación
      if (company.webhook_url) {
        await this.jobRepo.save(
          this.jobRepo.create({
            company_id: company.id,
            document_id: doc.id,
            job_type: JobType.DISPATCH_WEBHOOK,
            status: JobStatus.PENDING,
            payload: { event: 'DOCUMENT_ACCEPTED', document_id: doc.id, full_number: doc.full_number },
          }),
        );
      }
    } else if (sunatResult.isRetryableError) {
      // Error transitorio de red o caída de servidor SUNAT: forzar reintento del worker
      doc.sunat_response_code = sunatResult.responseCode;
      doc.sunat_description = sunatResult.description;
      await this.docRepo.save(doc);
      throw new Error(`Fallo temporal de comunicación con SUNAT: ${sunatResult.description}`);
    } else {
      // Rechazo formal por SUNAT: no reintentar
      doc.status = DocumentStatus.REJECTED;
      doc.sunat_response_code = sunatResult.responseCode;
      doc.sunat_description = sunatResult.description;
      doc.sunat_notes = sunatResult.notes || null;
      doc.cdr_xml = sunatResult.cdrXml || null;
      doc.cdr_zip_base64 = sunatResult.cdrZipBase64 || null;
      doc.sunat_response_at = new Date();
      await this.docRepo.save(doc);

      if (company.webhook_url) {
        await this.jobRepo.save(
          this.jobRepo.create({
            company_id: company.id,
            document_id: doc.id,
            job_type: JobType.DISPATCH_WEBHOOK,
            status: JobStatus.PENDING,
            payload: { event: 'DOCUMENT_REJECTED', document_id: doc.id, full_number: doc.full_number },
          }),
        );
      }
    }
  }

  /**
   * Despacho de Webhook a la URL configurada por la empresa cliente
   */
  private async handleDispatchWebhook(job: InvoiceJob) {
    const company = await this.companyRepo.findOne({ where: { id: job.company_id } });
    if (!company || !company.webhook_url) return;

    // Disparar petición HTTP POST con el evento tributario
    await axios.post(company.webhook_url, job.payload, {
      timeout: 8000,
      headers: {
        'x-ccofact-signature': 'CCOFACT-SECURE-WEBHOOK',
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Consulta el estado en tiempo real de los trabajos para el dashboard del frontend
   */
  public async getQueueStats() {
    const counts = await this.jobRepo
      .createQueryBuilder('j')
      .select('j.status', 'status')
      .addSelect('COUNT(j.id)', 'count')
      .groupBy('j.status')
      .getRawMany();

    const recentJobs = await this.jobRepo.find({
      order: { created_at: 'DESC' },
      take: 20,
    });

    return { counts, recentJobs };
  }
}
