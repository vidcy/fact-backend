import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Company, Document, DocumentItem } from '@prisma/client';
import { DocumentStatus, JobType, JobStatus } from '../../common/constants/system.enums';
import { CreateDocumentDto } from './dto/create-document.dto';
import { CcofactDocumentDto } from './dto/ccofact-document.dto';
import { SeriesService } from '../series/series.service';
import { UblBuilderService } from '../sunat-core/services/ubl-builder.service';
import { XmlSignerService } from '../sunat-core/services/xml-signer.service';
import { QrService } from '../sunat-core/services/qr.service';
import { SunatSoapService, SunatResponse } from '../sunat-core/services/sunat-soap.service';
import { PdfBuilderService } from '../sunat-core/services/pdf-builder.service';
import { SunatValidatorService } from '../sunat-core/services/sunat-validator.service';

/**
 * ============================================================================
 * CCOFACT PRO - MOTOR DE FACTURACIÓN ELECTRÓNICA UBL 2.1 (CORPORACIÓN CCOPLEX)
 * 100% PRISMA ORM - POSTGRESQL ACID TRANSACTIONS
 * ============================================================================
 * Este servicio orquesta el ciclo de vida fiscal completo de cada comprobante:
 * 1. Control estricto de Idempotencia por empresa para prevenir duplicaciones.
 * 2. Validación de reglas fiscales peruanas (Módulo 11 de RUC, DNI, topes de boletas).
 * 3. Transacción atómica ACID en PostgreSQL con reserva de correlativo pesimista.
 * 4. Desglose matemático exacto de gravadas, exoneradas, inafectas e IGV (18%).
 * 5. Generación del árbol XML conforme al estándar OASIS UBL 2.1 de SUNAT.
 * 6. Firma digital con certificado X.509 (.pfx), canonicalización C14N y digest SHA-256.
 * 7. Generación de la cadena y código QR bidimensional oficial (R.S. 340-2017/SUNAT).
 * 8. Envío directo SOAP 1.1 con WS-Security UsernameToken a los servidores de SUNAT.
 * 9. Despacho resiliente a colas de fondo PostgreSQL con reintentos exponenciales.
 */
@Injectable()
export class DocumentsService {
  // Logger institucional para trazabilidad de cada fase de emisión fiscal
  private readonly logger = new Logger('CCOFACT-DocumentsService');

  constructor(
    // Servicio Prisma ORM para queries relacionales y transacciones atómicas
    private prisma: PrismaService,

    // Servicio de numeración atómica con SELECT ... FOR UPDATE
    private seriesService: SeriesService,

    // Constructor de XML UBL 2.1 oficial SUNAT
    private ublBuilder: UblBuilderService,

    // Motor de firma digital XMLDSig con certificado X.509
    private xmlSigner: XmlSignerService,

    // Generador de código QR y cadena oficial pipe-separated
    private qrService: QrService,

    // Cliente SOAP 1.1 para comunicación directa con SUNAT
    private sunatSoap: SunatSoapService,

    // Generador de representación impresa (A4 Ejecutivo y Ticket POS 80mm)
    private pdfBuilder: PdfBuilderService,

    // Validador de normativas tributarias y algoritmo Módulo 11
    private validator: SunatValidatorService,
  ) {}

  /**
   * ==========================================================================
   * MOTOR NATIVO CCOFACT: EMISIÓN INTEGRAL DE COMPROBANTES ELECTRÓNICOS
   * ==========================================================================
   * Endpoint oficial: POST /api/v1/ccofact/emitir
   * Diseñado para conectar cualquier ERP, POS, E-Commerce o sistema administrativo.
   */
  public async processCcofact(company: Company, dto: CcofactDocumentDto): Promise<any> {
    const startTime = Date.now();

    // 1. Mapear DTO Ccofact al DTO interno de procesamiento de comprobantes
    const isCreditNote = dto.tipo_comprobante === '07';
    const isDebitNote = dto.tipo_comprobante === '08';
    const isNota = isCreditNote || isDebitNote;

    let clientDocType = dto.cliente.tipo_documento;
    let clientDocNum = (dto.cliente.numero_documento || '').trim();
    let clientName = (dto.cliente.razon_social || '').trim();

    if (clientDocType === '-' || !clientDocType) {
      clientDocType = (dto.tipo_comprobante === '01' || dto.ref_documento?.tipo === '01') ? '6' : '0';
    }
    if (clientDocType === '0' && (!clientDocNum || clientDocNum === '-')) {
      clientDocNum = '00000000';
    }
    if (!clientName) {
      clientName = clientDocType === '0' ? 'CLIENTES VARIOS' : 'CLIENTE GENERAL';
    }

    const refDocType = dto.ref_documento?.tipo || dto.referencia_tipo_comprobante || (dto.serie?.toUpperCase().startsWith('B') ? '03' : '01');
    const refSeries = (dto.ref_documento?.serie || dto.referencia_serie || (refDocType === '03' ? 'B001' : 'F001')).toUpperCase();
    const refNum = dto.ref_documento?.numero || dto.referencia_numero || (isNota ? 1 : undefined);
    const rawReasonCode = dto.ref_documento?.motivo_codigo || dto.referencia_codigo_motivo;
    const refReasonCode = rawReasonCode ? String(rawReasonCode).padStart(2, '0') : (isCreditNote ? '01' : isDebitNote ? '02' : undefined);
    const refReasonDesc = dto.ref_documento?.motivo_descripcion || dto.referencia_motivo_descripcion || (isCreditNote ? 'ANULACION DE LA OPERACION' : isDebitNote ? 'AUMENTO EN EL VALOR' : undefined);

    const internalDto: CreateDocumentDto = {
      idempotency_key: dto.idempotency_key,
      document_type: dto.tipo_comprobante,
      series: dto.serie.toUpperCase(),
      currency: dto.moneda || 'PEN',
      payment_type: dto.forma_pago || 'Contado',
      client_doc_type: clientDocType,
      client_doc_number: clientDocNum,
      client_name: clientName,
      client_address: dto.cliente.direccion || '',
      client_email: dto.cliente.email || '',
      ref_document_type: isNota ? refDocType : undefined,
      ref_series: isNota ? refSeries : undefined,
      ref_number: isNota ? refNum : undefined,
      ref_reason_code: isNota ? refReasonCode : undefined,
      ref_reason_desc: isNota ? refReasonDesc : undefined,
      items: dto.items.map((it) => ({
        code: it.codigo || '',
        description: it.descripcion,
        unit_measure: it.unidad_medida || 'NIU',
        quantity: Number(it.cantidad),
        unit_price: Number(it.precio_unitario),
        unit_value: it.valor_unitario ? Number(it.valor_unitario) : undefined,
        igv_affectation_type: it.tipo_afectacion_igv || '10',
      })),
      send_now: dto.enviar_a_sunat_inmediato !== false,
      metadata: dto.guia_datos ? { guia_datos: dto.guia_datos } : undefined,
      guia_datos: dto.guia_datos,
    };

    // 2. Ejecutar emisión atómica con bloqueo pesimista y firma digital
    const doc = await this.createDocument(company, internalDto);

    // 3. Calcular tiempo de procesamiento transcurrido
    const elapsedMs = Date.now() - startTime;

    // 4. Construir URLs públicas de descarga de recursos para el sistema cliente
    const baseUrl = `${process.env.APP_URL || `http://localhost:${process.env.PORT || 4001}`}/api/v1/documents/${doc.id}`;
    const tipoNombres: Record<string, string> = {
      '01': 'Factura Electrónica',
      '03': 'Boleta de Venta Electrónica',
      '07': 'Nota de Crédito Electrónica',
      '08': 'Nota de Débito Electrónica',
      '09': 'Guía de Remisión Electrónica',
    };

    // 5. Retornar el payload estructurado de respuesta CCOFACT PRO
    return {
      exito: true,
      mensaje: `Comprobante ${doc.full_number} procesado exitosamente por CCOFACT Engine`,
      tiempo_procesamiento_ms: elapsedMs,
      comprobante: {
        id: doc.id,
        tipo_comprobante: doc.document_type,
        tipo_comprobante_nombre: tipoNombres[doc.document_type] || 'Comprobante Electrónico',
        serie: doc.series,
        numero: doc.number,
        numero_completo: doc.full_number,
        fecha_emision: doc.issue_date,
        hora_emision: doc.issue_time,
        moneda: doc.currency,
        forma_pago: doc.payment_type,
        totales: {
          gravada: Number(doc.total_gravada),
          exonerada: Number(doc.total_exonerada),
          inafecta: Number(doc.total_inafecta),
          igv: Number(doc.total_igv),
          subtotal: Number(doc.subtotal),
          total: Number(doc.total_amount),
        },
      },
      emisor: {
        ruc: company.ruc,
        razon_social: company.razon_social,
        nombre_comercial: company.nombre_comercial,
        direccion: company.direccion,
      },
      cliente: {
        tipo_documento: doc.client_doc_type,
        numero_documento: doc.client_doc_number,
        razon_social: doc.client_name,
        direccion: doc.client_address,
        email: doc.client_email,
      },
      sunat: {
        estado: doc.status,
        aceptada_por_sunat: doc.status.includes('ACCEPTED'),
        codigo_respuesta: doc.sunat_response_code || '0',
        descripcion: doc.sunat_description || 'Comprobante procesado y firmado digitalmente',
        observaciones: doc.sunat_notes || [],
        codigo_hash: doc.xml_digest_value,
        cadena_qr: doc.qr_data,
      },
      recursos: {
        pdf_a4: `${baseUrl}/html?format=A4`,
        ticket_pos_80mm: `${baseUrl}/html?format=TICKET`,
        xml_firmado: `${baseUrl}/xml`,
        cdr_sunat: `${baseUrl}/cdr`,
      },
    };
  }



  /**
   * ==========================================================================
   * EMISIÓN DE COMPROBANTE CON BLOQUEO PESIMISTA ATÓMICO (100% PRISMA TRANSACTION)
   * ==========================================================================
   */
  public async createDocument(company: Company, dto: CreateDocumentDto): Promise<Document> {
    // ------------------------------------------------------------------------
    // FASE 1: CHEQUEO DE IDEMPOTENCIA
    // ------------------------------------------------------------------------
    if (dto.idempotency_key) {
      const existing = await this.prisma.document.findFirst({
        where: { company_id: company.id, idempotency_key: dto.idempotency_key },
        include: { items: true },
      });
      if (existing) {
        this.logger.log(`[IDEMPOTENCIA] Solicitud repetida con clave ${dto.idempotency_key}. Retornando comprobante existente ${existing.full_number}.`);
        return existing;
      }
    }

    // ------------------------------------------------------------------------
    // FASE 2: VALIDACIÓN FISCAL TRIBUTARIA SUNAT
    // ------------------------------------------------------------------------
    const validation = this.validator.validateDocument(dto);
    if (!validation.isValid) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Errores de validación tributaria SUNAT detectados por CCOFACT Engine',
        errors: validation.errors,
      });
    }

    // ------------------------------------------------------------------------
    // FASE 3 A 8: TRANSACCIÓN ATÓMICA EN POSTGRESQL CON PRISMA ($transaction)
    // ------------------------------------------------------------------------
    let createdDoc: Document;

    try {
      createdDoc = await this.prisma.$transaction(async (tx) => {
        // Bloqueo pesimista a nivel de fila (SELECT ... FOR UPDATE)
        const nextNumber = await this.seriesService.getNextCorrelative(
          tx,
          company.id,
          dto.document_type,
          dto.series,
        );

        const fullNumber = `${dto.series.toUpperCase()}-${String(nextNumber).padStart(8, '0')}`;
        const now = new Date();
        const issueDate = now.toISOString().split('T')[0];
        const issueTime = now.toTimeString().split(' ')[0];

        let totalGravada = 0;
        let totalExonerada = 0;
        let totalInafecta = 0;
        let totalIgv = 0;
        let subtotal = 0;
        let totalAmount = 0;

        const itemsToCreate: Array<{
          item_order: number;
          code: string;
          description: string;
          unit_measure: string;
          quantity: number;
          unit_value: number;
          unit_price: number;
          igv_affectation_type: string;
          igv_percentage: number;
          igv_amount: number;
          subtotal: number;
          total: number;
        }> = [];

        dto.items.forEach((it, idx) => {
          const qty = Number(it.quantity);
          const price = Number(it.unit_price);
          const affectation = it.igv_affectation_type || '10';

          let unitVal = it.unit_value ? Number(it.unit_value) : 0;
          let lineSubtotal = 0;
          let lineIgv = 0;
          let lineTotal = 0;

          if (affectation === '10') {
            if (!unitVal) unitVal = Number((price / 1.18).toFixed(4));
            lineSubtotal = Number((unitVal * qty).toFixed(2));
            lineTotal = Number((price * qty).toFixed(2));
            lineIgv = Number((lineTotal - lineSubtotal).toFixed(2));

            totalGravada += lineSubtotal;
            totalIgv += lineIgv;
            subtotal += lineSubtotal;
            totalAmount += lineTotal;
          } else if (affectation === '20') {
            unitVal = price;
            lineSubtotal = Number((unitVal * qty).toFixed(2));
            lineTotal = lineSubtotal;
            totalExonerada += lineSubtotal;
            subtotal += lineSubtotal;
            totalAmount += lineTotal;
          } else {
            unitVal = price;
            lineSubtotal = Number((unitVal * qty).toFixed(2));
            lineTotal = lineSubtotal;
            totalInafecta += lineSubtotal;
            subtotal += lineSubtotal;
            totalAmount += lineTotal;
          }

          itemsToCreate.push({
            item_order: idx + 1,
            code: it.code || '',
            description: it.description,
            unit_measure: it.unit_measure || 'NIU',
            quantity: qty,
            unit_value: unitVal,
            unit_price: price,
            igv_affectation_type: affectation,
            igv_percentage: affectation === '20' || affectation === '30' ? 0.0 : 18.0,
            igv_amount: affectation === '20' || affectation === '30' ? 0.0 : lineIgv,
            subtotal: lineSubtotal,
            total: lineTotal,
          });
        });

        // Crear encabezado e items de forma anidada atómica
        const savedDoc = await tx.document.create({
          data: {
            company_id: company.id,
            idempotency_key: dto.idempotency_key || null,
            document_type: dto.document_type,
            series: dto.series.toUpperCase(),
            number: nextNumber,
            full_number: fullNumber,
            issue_date: issueDate,
            issue_time: issueTime,
            due_date: null,
            currency: dto.currency || 'PEN',
            operation_type: dto.operation_type || '0101',
            payment_type: dto.payment_type || 'Contado',
            payment_terms: (dto.payment_terms as any) || null,
            client_doc_type: dto.client_doc_type,
            client_doc_number: dto.client_doc_number,
            client_name: dto.client_name,
            client_address: dto.client_address || '',
            client_email: dto.client_email || '',
            total_gravada: Number(totalGravada.toFixed(2)),
            total_exonerada: Number(totalExonerada.toFixed(2)),
            total_inafecta: Number(totalInafecta.toFixed(2)),
            total_gratuita: 0,
            total_igv: Number(totalIgv.toFixed(2)),
            total_isc: 0,
            total_icbper: 0,
            total_descuentos: 0,
            total_cargos: 0,
            subtotal: Number(subtotal.toFixed(2)),
            total_amount: Number(totalAmount.toFixed(2)),
            ref_document_type: dto.ref_document_type || null,
            ref_series: dto.ref_series ? dto.ref_series.toUpperCase() : null,
            ref_number: dto.ref_number || null,
            ref_reason_code: dto.ref_reason_code || null,
            ref_reason_desc: dto.ref_reason_desc || null,
            metadata: (dto.metadata as any) || (dto.guia_datos ? { guia_datos: dto.guia_datos } : null),
            status: DocumentStatus.DRAFT,
            items: {
              create: itemsToCreate,
            },
          },
          include: { items: true },
        });

        // Construcción de XML UBL 2.1 y firma digital X.509
        const rawXml = this.ublBuilder.buildInvoiceXml(savedDoc, company);
        const signResult = this.xmlSigner.signXml(
          rawXml,
          company.certificate_pfx_base64 || '',
          company.certificate_password || '',
        );

        // Generación de código QR oficial SUNAT
        const qrData = this.qrService.generateQrString(
          savedDoc,
          company,
          signResult.digestValue,
        );

        return await tx.document.update({
          where: { id: savedDoc.id },
          data: {
            xml_content: signResult.signedXml,
            xml_digest_value: signResult.digestValue,
            xml_signature_value: signResult.signatureValue,
            qr_data: qrData,
            status: DocumentStatus.SIGNED,
          },
          include: { items: true },
        });
      });
    } catch (err: any) {
      this.logger.error('Fallo en la creación transaccional del comprobante', err);
      throw new BadRequestException(`No se pudo generar el comprobante: ${err.message}`);
    }

    // ------------------------------------------------------------------------
    // FASE 9: ENVÍO SÍNCRONO DIRECTO O ENCOLADO A SUNAT
    // ------------------------------------------------------------------------
    const shouldSendNow = dto.send_now !== false;

    if (shouldSendNow) {
      await this.prisma.document.update({
        where: { id: createdDoc.id },
        data: { status: DocumentStatus.SENDING },
      });

      const sunatResult = await this.sunatSoap.sendBill(
        createdDoc,
        company,
        createdDoc.xml_content || '',
      );

      if (sunatResult.success) {
        const nextStatus =
          sunatResult.notes && sunatResult.notes.length > 0
            ? DocumentStatus.ACCEPTED_OBSERVED
            : DocumentStatus.ACCEPTED;

        await this.prisma.document.update({
          where: { id: createdDoc.id },
          data: {
            status: nextStatus,
            sunat_response_code: sunatResult.responseCode,
            sunat_description: sunatResult.description,
            sunat_notes: sunatResult.notes ? (sunatResult.notes as any) : undefined,
            cdr_xml: sunatResult.cdrXml || null,
            cdr_zip_base64: sunatResult.cdrZipBase64 || null,
            sunat_response_at: new Date(),
          },
        });

        // Si la empresa tiene webhook configurado, encolar el evento para notificación
        if (company.webhook_url) {
          await this.prisma.invoiceJob.create({
            data: {
              company_id: company.id,
              document_id: createdDoc.id,
              job_type: JobType.DISPATCH_WEBHOOK,
              status: JobStatus.PENDING,
              payload: { event: 'DOCUMENT_ACCEPTED', document_id: createdDoc.id },
            },
          });
        }
      } else if (sunatResult.isRetryableError) {
        this.logger.warn(
          `Comprobante ${createdDoc.full_number} no pudo enviarse síncronamente (${sunatResult.description}). Encolando en sistema de reintentos...`,
        );

        await this.prisma.document.update({
          where: { id: createdDoc.id },
          data: {
            status: DocumentStatus.QUEUED,
            sunat_description: sunatResult.description,
          },
        });

        await this.prisma.invoiceJob.create({
          data: {
            company_id: company.id,
            document_id: createdDoc.id,
            job_type: JobType.SEND_BILL,
            status: JobStatus.PENDING,
            next_run_at: new Date(Date.now() + 10000),
            payload: { full_number: createdDoc.full_number },
          },
        });
      } else {
        // Rechazo formal por SUNAT
        await this.prisma.document.update({
          where: { id: createdDoc.id },
          data: {
            status: DocumentStatus.REJECTED,
            sunat_response_code: sunatResult.responseCode,
            sunat_description: sunatResult.description,
            sunat_notes: sunatResult.notes ? (sunatResult.notes as any) : undefined,
            cdr_xml: sunatResult.cdrXml || null,
            cdr_zip_base64: sunatResult.cdrZipBase64 || null,
            sunat_response_at: new Date(),
          },
        });

        if (company.webhook_url) {
          await this.prisma.invoiceJob.create({
            data: {
              company_id: company.id,
              document_id: createdDoc.id,
              job_type: JobType.DISPATCH_WEBHOOK,
              status: JobStatus.PENDING,
              payload: { event: 'DOCUMENT_REJECTED', document_id: createdDoc.id },
            },
          });
        }
      }
    } else {
      // Envío asíncrono solicitado explícitamente por el cliente
      await this.prisma.document.update({
        where: { id: createdDoc.id },
        data: { status: DocumentStatus.QUEUED },
      });

      await this.prisma.invoiceJob.create({
        data: {
          company_id: company.id,
          document_id: createdDoc.id,
          job_type: JobType.SEND_BILL,
          status: JobStatus.PENDING,
          payload: { full_number: createdDoc.full_number },
        },
      });
    }

    return await this.getDocumentById(company.id, createdDoc.id);
  }

  /**
   * Obtener un comprobante por ID
   */
  public async getDocumentById(companyId: string, id: string): Promise<Document & { items: DocumentItem[]; company?: Company }> {
    const doc = await this.prisma.document.findFirst({
      where: { id, company_id: companyId },
      include: { items: true, company: true },
    });
    if (!doc) {
      throw new NotFoundException(`Comprobante con id ${id} no encontrado`);
    }
    return doc;
  }

  /**
   * Obtener un comprobante por ID público (acceso directo para descarga de XML, CDR o visualización)
   */
  public async getDocumentByIdPublic(id: string): Promise<Document & { items: DocumentItem[]; company?: Company }> {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: { items: true, company: true },
    });
    if (!doc) {
      throw new NotFoundException(`Comprobante con id ${id} no encontrado`);
    }
    return doc;
  }

  /**
   * Listar comprobantes con paginación y filtros
   */
  public async getDocuments(
    companyId: string,
    filters: {
      document_type?: string;
      status?: string;
      series?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ data: any[]; total: number }> {
    const where: any = { company_id: companyId };

    if (filters.document_type) {
      where.document_type = filters.document_type;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.series) {
      where.series = filters.series.toUpperCase();
    }

    const [data, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: { items: true },
        orderBy: { created_at: 'desc' },
        skip: filters.offset || 0,
        take: filters.limit || 50,
      }),
      this.prisma.document.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Generar representación visual HTML (A4 o Ticket POS 80mm) con QR y Hash
   */
  public async generateHtmlPreview(
    company: Company | undefined,
    id: string,
    format: 'A4' | 'TICKET',
  ): Promise<string> {
    const doc = await this.getDocumentByIdPublic(id);
    const targetCompany = company || doc.company;
    if (!targetCompany) {
      throw new NotFoundException(`Empresa emisora del comprobante no encontrada`);
    }
    const qrDataUrl = await this.qrService.generateQrBase64Image(doc.qr_data || 'SUNAT-QR');

    if (format === 'TICKET') {
      return this.pdfBuilder.buildTicketHtml(doc, targetCompany, qrDataUrl);
    }
    return this.pdfBuilder.buildA4Html(doc, targetCompany, qrDataUrl);
  }

  /**
   * Reintentar envío manual a SUNAT
   */
  public async retryDocument(company: Company, id: string): Promise<Document> {
    const doc = await this.getDocumentById(company.id, id);

    if (doc.status === DocumentStatus.ACCEPTED || doc.status === DocumentStatus.ACCEPTED_OBSERVED) {
      throw new BadRequestException('El comprobante ya fue aceptado por SUNAT previamente');
    }

    await this.prisma.document.update({
      where: { id: doc.id },
      data: { status: DocumentStatus.SENDING },
    });

    let sunatResult: SunatResponse;
    if (doc.sunat_response_code?.includes('0140') || doc.sunat_description?.includes('0140')) {
      this.logger.log(`[RETRY] Comprobante ${doc.full_number} en estado 0140 (En Proceso). Consultando CDR con getStatusCdr...`);
      sunatResult = await this.sunatSoap.getStatusCdr(company, doc.document_type, doc.series, doc.number);
      if (!sunatResult.success && !sunatResult.cdrZipBase64 && !sunatResult.responseCode?.includes('0140')) {
        sunatResult = await this.sunatSoap.sendBill(doc, company, doc.xml_content || '');
      }
    } else {
      sunatResult = await this.sunatSoap.sendBill(doc, company, doc.xml_content || '');
      if (sunatResult.responseCode?.includes('0140') || sunatResult.description?.includes('0140')) {
        this.logger.log(`[RETRY] SUNAT retornó 0140 para ${doc.full_number}. Verificando si el CDR ya fue emitido...`);
        const cdrCheck = await this.sunatSoap.getStatusCdr(company, doc.document_type, doc.series, doc.number);
        if (cdrCheck.success || cdrCheck.cdrZipBase64) {
          sunatResult = cdrCheck;
        }
      }
    }

    const updateData: any = {};
    if (sunatResult.success) {
      updateData.status =
        sunatResult.notes && sunatResult.notes.length > 0
          ? DocumentStatus.ACCEPTED_OBSERVED
          : DocumentStatus.ACCEPTED;
      updateData.sunat_response_code = sunatResult.responseCode;
      updateData.sunat_description = sunatResult.description;
      updateData.sunat_notes = sunatResult.notes ? (sunatResult.notes as any) : undefined;
      updateData.cdr_xml = sunatResult.cdrXml || null;
      updateData.cdr_zip_base64 = sunatResult.cdrZipBase64 || null;
      updateData.sunat_response_at = new Date();
    } else {
      updateData.status = sunatResult.isRetryableError ? DocumentStatus.QUEUED : DocumentStatus.REJECTED;
      updateData.sunat_response_code = sunatResult.responseCode;
      updateData.sunat_description = sunatResult.description;
    }

    return await this.prisma.document.update({
      where: { id: doc.id },
      data: updateData,
      include: { items: true },
    });
  }

  /**
   * Consulta explícita de CDR en SUNAT (billConsultService: getStatusCdr)
   * Permite regularizar cualquier comprobante cuyo envío quedó en suspenso o con 0140
   */
  public async consultarCdrSunat(company: Company, id: string): Promise<Document> {
    const doc = await this.getDocumentById(company.id, id);

    this.logger.log(`Consultando CDR en SUNAT para comprobante ${doc.full_number}...`);
    const sunatResult = await this.sunatSoap.getStatusCdr(
      company,
      doc.document_type,
      doc.series,
      doc.number,
    );

    const updateData: any = {};
    if (sunatResult.success || sunatResult.cdrZipBase64) {
      updateData.status =
        sunatResult.notes && sunatResult.notes.length > 0
          ? DocumentStatus.ACCEPTED_OBSERVED
          : DocumentStatus.ACCEPTED;
      updateData.sunat_response_code = sunatResult.responseCode;
      updateData.sunat_description = sunatResult.description;
      updateData.sunat_notes = sunatResult.notes ? (sunatResult.notes as any) : undefined;
      updateData.cdr_xml = sunatResult.cdrXml || null;
      updateData.cdr_zip_base64 = sunatResult.cdrZipBase64 || null;
      updateData.sunat_response_at = new Date();
    } else {
      updateData.sunat_response_code = sunatResult.responseCode;
      updateData.sunat_description = sunatResult.description;
      if (!sunatResult.isRetryableError) {
        updateData.status = DocumentStatus.REJECTED;
      }
    }

    return await this.prisma.document.update({
      where: { id: doc.id },
      data: updateData,
      include: { items: true },
    });
  }

  /**
   * Eliminar físicamente un comprobante del sistema CCOFACT
   * Limpia items dependientes, trabajos en cola y el registro maestro del comprobante en transacción atómica
   */
  public async deleteDocument(companyId: string, id: string): Promise<{ success: boolean; message: string }> {
    const doc = await this.prisma.document.findFirst({
      where: { id, company_id: companyId },
    });

    if (!doc) {
      throw new NotFoundException(`Comprobante con ID ${id} no encontrado en la empresa`);
    }

    const fullNumber = doc.full_number;
    const docId = doc.id;

    await this.prisma.$transaction(async (tx) => {
      // 1. Limpiar colas de contingencia e historial de reintentos
      await tx.invoiceJob.deleteMany({ where: { document_id: doc.id } });
      // 2. Eliminar items asociados si existen
      await tx.documentItem.deleteMany({ where: { document_id: doc.id } });
      // 3. Eliminar el comprobante
      await tx.document.delete({ where: { id: doc.id } });
    });

    this.logger.log(`[ELIMINACIÓN] Comprobante ${fullNumber} (${docId}) eliminado exitosamente.`);
    return {
      success: true,
      message: `Comprobante ${fullNumber} eliminado exitosamente del sistema de facturación.`,
    };
  }

  /**
   * Eliminar comprobante buscando por Serie y Número correlativo
   * Ideal para sincronizaciones externas cuando un sistema como Control Finanzas elimina una venta
   */
  public async deleteBySeriesAndNumber(
    companyId: string,
    series: string,
    number: number,
  ): Promise<{ success: boolean; message: string }> {
    const doc = await this.prisma.document.findFirst({
      where: {
        company_id: companyId,
        series: series.toUpperCase(),
        number: Number(number),
      },
    });

    if (!doc) {
      this.logger.warn(`Intento de eliminar comprobante no existente: ${series}-${number}`);
      return {
        success: false,
        message: `Comprobante ${series}-${number} no encontrado en el sistema.`,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.invoiceJob.deleteMany({ where: { document_id: doc.id } });
      await tx.documentItem.deleteMany({ where: { document_id: doc.id } });
      await tx.document.delete({ where: { id: doc.id } });
    });

    this.logger.log(`[ELIMINACIÓN REMOTA] Comprobante ${series}-${number} eliminado sincronizadamente.`);
    return {
      success: true,
      message: `Comprobante ${series}-${number} eliminado exitosamente del sistema de facturación.`,
    };
  }

  /**
   * Anulación fiscal de un comprobante
   * Cambia su estado a ANULADO y registra la justificación
   */
  public async anularDocument(
    companyId: string,
    id: string,
    motivo: string = 'Anulación de la operación por el emisor',
  ): Promise<Document> {
    const doc = await this.getDocumentById(companyId, id);

    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data: {
        status: DocumentStatus.ANULADO,
        metadata: {
          ...((doc.metadata as any) || {}),
          anulado_at: new Date().toISOString(),
          motivo_anulacion: motivo,
        },
      },
      include: { items: true },
    });

    this.logger.log(`[ANULACIÓN] Comprobante ${doc.full_number} marcado como ANULADO. Motivo: ${motivo}`);
    return updated;
  }

  /**
   * PROCEDIMIENTO OFICIAL SUNAT: ANULACIÓN MEDIANTE NOTA DE CRÉDITO (Catálogo 09 Motivo 01)
   * Resolución de Superintendencia N.° 097-2012/SUNAT y Catálogo N.° 09 SUNAT
   */
  public async anularWithCreditNote(
    company: Company,
    documentId: string,
    motivo: string = 'ANULACION DE LA OPERACION',
  ): Promise<{
    success: boolean;
    comprobante_original: {
      id: string;
      full_number: string;
      status: string;
    };
    nota_credito: {
      id: string;
      full_number: string;
      status: string;
      sunat_description?: string;
    };
    message: string;
  }> {
    const originalDoc = await this.getDocumentById(company.id, documentId);

    if (originalDoc.status === DocumentStatus.ANULADO) {
      throw new BadRequestException(`El comprobante ${originalDoc.full_number} ya se encuentra anulado.`);
    }

    if (originalDoc.document_type !== '01' && originalDoc.document_type !== '03') {
      throw new BadRequestException('Solo se pueden anular Facturas (01) o Boletas de Venta (03) con Nota de Crédito.');
    }

    const origSeries = originalDoc.series || '';
    const ncSeries = originalDoc.document_type === '01'
      ? (origSeries.startsWith('F') && origSeries.length === 4 ? `FC${origSeries.substring(2)}` : 'FC01')
      : (origSeries.startsWith('B') && origSeries.length === 4 ? `BC${origSeries.substring(2)}` : 'BC01');

    const ncDto: CreateDocumentDto = {
      idempotency_key: `nc_anulacion_${originalDoc.id}_${Date.now()}`,
      document_type: '07',
      series: ncSeries,
      currency: originalDoc.currency,
      client_doc_type: originalDoc.client_doc_type,
      client_doc_number: originalDoc.client_doc_number,
      client_name: originalDoc.client_name,
      client_address: originalDoc.client_address || '',
      client_email: originalDoc.client_email || '',
      ref_document_type: originalDoc.document_type,
      ref_series: originalDoc.series,
      ref_number: originalDoc.number,
      ref_reason_code: '01',
      ref_reason_desc: (motivo || 'ANULACION DE LA OPERACION').toUpperCase(),
      items:
        originalDoc.items && originalDoc.items.length > 0
          ? originalDoc.items.map((it) => ({
              code: it.code || 'ITEM',
              description: it.description || 'CONSUMO',
              unit_measure: it.unit_measure || 'NIU',
              quantity: Number(it.quantity) || 1,
              unit_price: Number(it.unit_price) || Number(originalDoc.total_amount),
              igv_affectation_type: it.igv_affectation_type || (Number(originalDoc.total_exonerada) > 0 ? '20' : '10'),
            }))
          : [
              {
                code: 'ITEM',
                description: 'CONSUMO',
                unit_measure: 'NIU',
                quantity: 1,
                unit_price: Number(originalDoc.total_amount) || 10,
                igv_affectation_type: Number(originalDoc.total_exonerada) > 0 ? '20' : '10',
              },
            ],
      send_now: true,
    };

    const creditNoteDoc = await this.createDocument(company, ncDto);

    await this.prisma.document.update({
      where: { id: originalDoc.id },
      data: {
        status: DocumentStatus.ANULADO,
        metadata: {
          ...((originalDoc.metadata as any) || {}),
          anulacion_legal: {
            tipo: 'NOTA_DE_CREDITO',
            nota_credito_id: creditNoteDoc.id,
            nota_credito_numero: creditNoteDoc.full_number,
            motivo: ncDto.ref_reason_desc,
            fecha_anulacion: new Date().toISOString(),
          },
        },
      },
    });

    this.logger.log(
      `[ANULACIÓN LEGAL SUNAT] Comprobante ${originalDoc.full_number} anulado formalmente con Nota de Crédito ${creditNoteDoc.full_number}`,
    );

    return {
      success: true,
      comprobante_original: {
        id: originalDoc.id,
        full_number: originalDoc.full_number,
        status: DocumentStatus.ANULADO,
      },
      nota_credito: {
        id: creditNoteDoc.id,
        full_number: creditNoteDoc.full_number,
        status: creditNoteDoc.status,
        sunat_description: creditNoteDoc.sunat_description || 'Aceptada por SUNAT',
      },
      message: `Comprobante ${originalDoc.full_number} anulado exitosamente conforme a Ley SUNAT mediante Nota de Crédito ${creditNoteDoc.full_number}.`,
    };
  }

  /**
   * Anulación fiscal buscando por Serie y Número
   */
  public async anularFiscalBySeriesAndNumber(
    company: Company,
    series: string,
    number: number,
    motivo: string = 'ANULACION DE LA OPERACION',
  ) {
    const doc = await this.prisma.document.findFirst({
      where: {
        company_id: company.id,
        series: series.toUpperCase(),
        number: Number(number),
      },
      include: { items: true },
    });

    if (!doc) {
      return {
        success: false,
        message: `Comprobante ${series}-${number} no encontrado en el sistema.`,
      };
    }

    return this.anularWithCreditNote(company, doc.id, motivo);
  }

  /**
   * Obtiene la lista de series fiscales de la empresa
   */
  public async getCompanySeries(companyId: string) {
    return this.seriesService.getSeriesByCompany(companyId);
  }

  /**
   * MODIFICAR COMPROBANTE EXISTENTE (En borrador o rechazado)
   * Permite actualizar datos del cliente, condiciones o ítems recalculando impuestos.
   * Si el comprobante ya está aceptado por SUNAT, se bloquea la modificación directa
   * conforme a la normativa tributaria y se indica usar /rectificar.
   */
  public async updateDocument(
    company: Company,
    id: string,
    dto: Partial<CreateDocumentDto>,
  ) {
    const doc = await this.getDocumentById(company.id, id);

    if (doc.status === DocumentStatus.ACCEPTED) {
      throw new BadRequestException(
        `El comprobante ${doc.full_number} ya fue ACEPTADO por SUNAT con CDR. Conforme a la Ley SUNAT (R.S. 097-2012), no es posible modificarlo directamente. Debe rectificarlo mediante Nota de Crédito utilizando el endpoint /rectificar.`,
      );
    }

    const updateData: any = {};
    if (dto.client_name) updateData.client_name = dto.client_name;
    if (dto.client_doc_type) updateData.client_doc_type = dto.client_doc_type;
    if (dto.client_doc_number) updateData.client_doc_number = dto.client_doc_number;
    if (dto.client_address !== undefined) updateData.client_address = dto.client_address;
    if (dto.client_email !== undefined) updateData.client_email = dto.client_email;
    if (dto.currency) updateData.currency = dto.currency;
    if (dto.payment_type) updateData.payment_type = dto.payment_type;

    let savedDoc: any;

    if (dto.items && dto.items.length > 0) {
      let totalGravada = 0;
      let totalExonerada = 0;
      let totalInafecta = 0;
      let totalIgv = 0;
      let subtotal = 0;
      let totalAmount = 0;

      const newItems: any[] = [];

      dto.items.forEach((it, idx) => {
        const qty = Number(it.quantity);
        const price = Number(it.unit_price);
        const affectation = it.igv_affectation_type || '10';

        let unitVal = it.unit_value ? Number(it.unit_value) : 0;
        let lineSubtotal = 0;
        let lineIgv = 0;
        let lineTotal = 0;

        if (affectation === '10') {
          if (!unitVal) unitVal = Number((price / 1.18).toFixed(4));
          lineSubtotal = Number((unitVal * qty).toFixed(2));
          lineTotal = Number((price * qty).toFixed(2));
          lineIgv = Number((lineTotal - lineSubtotal).toFixed(2));

          totalGravada += lineSubtotal;
          totalIgv += lineIgv;
          subtotal += lineSubtotal;
          totalAmount += lineTotal;
        } else if (affectation === '20') {
          unitVal = price;
          lineSubtotal = Number((unitVal * qty).toFixed(2));
          lineTotal = lineSubtotal;
          totalExonerada += lineSubtotal;
          subtotal += lineSubtotal;
          totalAmount += lineTotal;
        } else {
          unitVal = price;
          lineSubtotal = Number((unitVal * qty).toFixed(2));
          lineTotal = lineSubtotal;
          totalInafecta += lineSubtotal;
          subtotal += lineSubtotal;
          totalAmount += lineTotal;
        }

        newItems.push({
          document_id: doc.id,
          item_order: idx + 1,
          code: it.code || '',
          description: it.description,
          unit_measure: it.unit_measure || 'NIU',
          quantity: qty,
          unit_value: unitVal,
          unit_price: price,
          igv_affectation_type: affectation,
          igv_percentage: 18.0,
          igv_amount: lineIgv,
          subtotal: lineSubtotal,
          total: lineTotal,
        });
      });

      updateData.total_gravada = Number(totalGravada.toFixed(2));
      updateData.total_exonerada = Number(totalExonerada.toFixed(2));
      updateData.total_inafecta = Number(totalInafecta.toFixed(2));
      updateData.total_igv = Number(totalIgv.toFixed(2));
      updateData.subtotal = Number(subtotal.toFixed(2));
      updateData.total_amount = Number(totalAmount.toFixed(2));

      savedDoc = await this.prisma.$transaction(async (tx) => {
        await tx.documentItem.deleteMany({ where: { document_id: doc.id } });
        await tx.documentItem.createMany({ data: newItems });
        return await tx.document.update({
          where: { id: doc.id },
          data: updateData,
          include: { items: true },
        });
      });
    } else {
      savedDoc = await this.prisma.document.update({
        where: { id: doc.id },
        data: updateData,
        include: { items: true },
      });
    }

    if (dto.send_now) {
      return this.retryDocument(company, savedDoc.id);
    }

    return {
      success: true,
      message: `Comprobante ${savedDoc.full_number} actualizado exitosamente.`,
      comprobante: savedDoc,
    };
  }

  /**
   * RECTIFICAR / MODIFICAR COMPROBANTE ACEPTADO CON NOTA DE CRÉDITO Y REEMPLAZO
   */
  public async rectificarDocument(
    company: Company,
    id: string,
    nuevoDto: CcofactDocumentDto,
    motivoAnulacion: string = 'ANULACION POR MODIFICACION Y RECTIFICACION DE COMPROBANTE',
  ) {
    const originalDoc = await this.getDocumentById(company.id, id);

    // 1. Anular el comprobante original mediante Nota de Crédito
    const anulacionResult = await this.anularWithCreditNote(company, id, motivoAnulacion);

    // 2. Emitir el nuevo comprobante corregido
    nuevoDto.idempotency_key = nuevoDto.idempotency_key || `rect_${originalDoc.id}_${Date.now()}`;
    const emisionResult = await this.processCcofact(company, nuevoDto);

    // 3. Vincular metadatos de reemplazo en el comprobante original
    await this.prisma.document.update({
      where: { id: originalDoc.id },
      data: {
        metadata: {
          ...((originalDoc.metadata as any) || {}),
          rectificado: {
            fecha: new Date().toISOString(),
            nota_credito: anulacionResult.nota_credito.full_number,
            nuevo_comprobante: emisionResult.comprobante?.numero_completo,
          },
        },
      },
    });

    return {
      success: true,
      message: `Comprobante ${originalDoc.full_number} rectificado exitosamente ante SUNAT. Se emitió la Nota de Crédito ${anulacionResult.nota_credito.full_number} y el nuevo comprobante ${emisionResult.comprobante?.numero_completo}.`,
      comprobante_original_anulado: {
        id: originalDoc.id,
        full_number: originalDoc.full_number,
        nota_credito: anulacionResult.nota_credito,
      },
      nuevo_comprobante: emisionResult.comprobante,
      recursos_nuevo: emisionResult.recursos,
    };
  }
}
