import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { SunatSoapService } from '../sunat-core/services/sunat-soap.service';
import { JobType, JobStatus, DocumentStatus } from '../../common/constants/system.enums';
import { InvoiceJob, Document, Company } from '@prisma/client';

/**
 * ============================================================================
 * CCOFACT PRO - SERVICIO DE COLAS TRANSACCIONALES (100% PRISMA ORM)
 * CORPORACIÓN CCOPLEX
 * ============================================================================
 * Arquitectura de Procesamiento Asíncrono de Alta Disponibilidad:
 * - Emplea el comando `FOR UPDATE SKIP LOCKED` nativo de PostgreSQL 18.
 * - Reintentos con algoritmo de retroceso exponencial (Exponential Backoff):
 *   Intento 1: +15 seg | Intento 2: +1 min | Intento 3: +5 min | Intento 4: +15 min | Intento 5: +1 hora
 * - Despacho de Webhooks HTTP para notificar instantáneamente a sistemas externos (ERP/POS).
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('CCOFACT-QueueWorker');
  private workerInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sunatSoap: SunatSoapService,
  ) {}

  onModuleInit() {
    this.logger.log('Iniciando Worker de Colas Transaccionales (PostgreSQL SKIP LOCKED)...');
    this.workerInterval = setInterval(() => {
      this.processNextJobs().catch((err) => {
        this.logger.error('Error en ciclo del worker de colas:', err.message);
      });
    }, 4000);
  }

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
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      let jobIds: string[] = [];

      await this.prisma.$transaction(async (tx) => {
        const rawJobs = await tx.$queryRawUnsafe<any[]>(
          `SELECT id FROM invoice_jobs 
           WHERE status = $1 AND next_run_at <= NOW()
           ORDER BY next_run_at ASC 
           LIMIT 5 
           FOR UPDATE SKIP LOCKED`,
          JobStatus.PENDING,
        );

        if (!rawJobs || rawJobs.length === 0) return;

        jobIds = rawJobs.map((r: any) => r.id);

        await tx.$executeRawUnsafe(
          `UPDATE invoice_jobs 
           SET status = $1, locked_at = NOW(), locked_by = $2, updated_at = NOW() 
           WHERE id = ANY($3::uuid[])`,
          JobStatus.PROCESSING,
          'worker_instance_1',
          jobIds,
        );
      });

      for (const jId of jobIds) {
        await this.executeJob(jId);
      }
    } catch (err: any) {
      this.logger.error('Error en adquisición de lote SKIP LOCKED:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Ejecución individual de un trabajo específico según su tipo.
   */
  private async executeJob(jobId: string) {
    const job = await this.prisma.invoiceJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    try {
      this.logger.log(`[WORKER] Procesando trabajo: ${job.id} | Tipo: ${job.job_type} | Intento: ${job.attempts + 1}`);

      if (job.job_type === JobType.SEND_BILL) {
        await this.handleSendBillJob(job);
      } else if (job.job_type === JobType.DISPATCH_WEBHOOK) {
        await this.handleDispatchWebhook(job);
      }

      await this.prisma.invoiceJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          last_error: '',
          updated_at: new Date(),
        },
      });

      this.logger.log(`[WORKER] Trabajo ${job.id} COMPLETADO con éxito.`);
    } catch (err: any) {
      const attempts = job.attempts + 1;
      const lastError = err.message || 'Error desconocido';

      if (attempts >= job.max_attempts) {
        await this.prisma.invoiceJob.update({
          where: { id: jobId },
          data: {
            attempts,
            status: JobStatus.FAILED,
            last_error: lastError,
            updated_at: new Date(),
          },
        });
        this.logger.error(`[WORKER] Trabajo ${job.id} FALLÓ definitivamente tras ${attempts} intentos: ${err.message}`);
      } else {
        const delaySeconds = [15, 60, 300, 900, 3600][attempts - 1] || 3600;
        await this.prisma.invoiceJob.update({
          where: { id: jobId },
          data: {
            attempts,
            status: JobStatus.PENDING,
            next_run_at: new Date(Date.now() + delaySeconds * 1000),
            last_error: lastError,
            updated_at: new Date(),
          },
        });
        this.logger.warn(`[WORKER] Trabajo ${job.id} falló temporalmente. Reintento ${attempts}/${job.max_attempts} programado en ${delaySeconds}s.`);
      }
    }
  }

  /**
   * Envío de comprobante por SOAP a SUNAT dentro del worker con resiliencia 0140
   */
  private async handleSendBillJob(job: InvoiceJob) {
    const doc = await this.prisma.document.findUnique({ where: { id: job.document_id } });
    if (!doc) throw new Error(`Comprobante con ID ${job.document_id} no encontrado en la base de datos`);

    const company = await this.prisma.company.findUnique({ where: { id: job.company_id } });
    if (!company) throw new Error(`Empresa emisora con ID ${job.company_id} no encontrada`);

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
        sunatResult = await this.sunatSoap.sendBill(doc, company, doc.xml_content || '');
      }
    } else {
      sunatResult = await this.sunatSoap.sendBill(doc, company, doc.xml_content || '');
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
      const finalStatus =
        sunatResult.notes && sunatResult.notes.length > 0
          ? DocumentStatus.ACCEPTED_OBSERVED
          : DocumentStatus.ACCEPTED;

      await this.prisma.document.update({
        where: { id: doc.id },
        data: {
          status: finalStatus,
          sunat_response_code: sunatResult.responseCode || '0',
          sunat_description: sunatResult.description || 'Aceptado por SUNAT',
          sunat_notes: sunatResult.notes ? JSON.stringify(sunatResult.notes) : undefined,
          cdr_xml: sunatResult.cdrXml || null,
          cdr_zip_base64: sunatResult.cdrZipBase64 || null,
          sunat_response_at: new Date(),
        },
      });

      if (company.webhook_url) {
        await this.prisma.invoiceJob.create({
          data: {
            company_id: company.id,
            document_id: doc.id,
            job_type: JobType.DISPATCH_WEBHOOK,
            status: JobStatus.PENDING,
            payload: { event: 'DOCUMENT_ACCEPTED', document_id: doc.id, full_number: doc.full_number },
          },
        });
      }
    } else if (sunatResult.isRetryableError) {
      await this.prisma.document.update({
        where: { id: doc.id },
        data: {
          sunat_response_code: sunatResult.responseCode || null,
          sunat_description: sunatResult.description || null,
        },
      });
      throw new Error(`Fallo temporal de comunicación con SUNAT: ${sunatResult.description}`);
    } else {
      await this.prisma.document.update({
        where: { id: doc.id },
        data: {
          status: DocumentStatus.REJECTED,
          sunat_response_code: sunatResult.responseCode || null,
          sunat_description: sunatResult.description || null,
          sunat_notes: sunatResult.notes ? JSON.stringify(sunatResult.notes) : undefined,
          cdr_xml: sunatResult.cdrXml || null,
          cdr_zip_base64: sunatResult.cdrZipBase64 || null,
          sunat_response_at: new Date(),
        },
      });

      if (company.webhook_url) {
        await this.prisma.invoiceJob.create({
          data: {
            company_id: company.id,
            document_id: doc.id,
            job_type: JobType.DISPATCH_WEBHOOK,
            status: JobStatus.PENDING,
            payload: { event: 'DOCUMENT_REJECTED', document_id: doc.id, full_number: doc.full_number },
          },
        });
      }
    }
  }

  /**
   * Despacho de Webhook a la URL configurada por la empresa cliente
   */
  private async handleDispatchWebhook(job: InvoiceJob) {
    const company = await this.prisma.company.findUnique({ where: { id: job.company_id } });
    if (!company || !company.webhook_url) return;

    await axios.post(company.webhook_url, job.payload as any, {
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
    const rawCounts = await this.prisma.invoiceJob.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const counts = rawCounts.map((c) => ({
      status: c.status,
      count: String(c._count.id),
    }));

    const recentJobs = await this.prisma.invoiceJob.findMany({
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    return { counts, recentJobs };
  }
}
