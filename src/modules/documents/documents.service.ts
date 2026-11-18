import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Document, DocumentStatus } from '../../entities/document.entity';
import { DocumentItem } from '../../entities/document-item.entity';
import { Company } from '../../entities/company.entity';
import { InvoiceJob, JobType, JobStatus } from '../../entities/invoice-job.entity';
import { CreateDocumentDto } from './dto/create-document.dto';
import { CcofactDocumentDto } from './dto/ccofact-document.dto';
import { NubefactPayloadDto } from './dto/nubefact-payload.dto';
import { SeriesService } from '../series/series.service';
import { UblBuilderService } from '../sunat-core/services/ubl-builder.service';
import { XmlSignerService } from '../sunat-core/services/xml-signer.service';
import { QrService } from '../sunat-core/services/qr.service';
import { SunatSoapService, SunatResponse } from '../sunat-core/services/sunat-soap.service';
import { PdfBuilderService } from '../sunat-core/services/pdf-builder.service';
import { SunatValidatorService } from '../sunat-core/services/sunat-validator.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ============================================================================
 * CCOFACT PRO - MOTOR DE FACTURACIÓN ELECTRÓNICA UBL 2.1 (CORPORACIÓN CCOPLEX)
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
    // Repositorio de comprobantes para lectura y persistencia
    @InjectRepository(Document)
    private documentRepo: Repository<Document>,

    // Repositorio de trabajos en cola para procesamiento en segundo plano
    @InjectRepository(InvoiceJob)
    private jobRepo: Repository<InvoiceJob>,

    // DataSource para transacciones atómicas
    private dataSource: DataSource,

    // Servicio Prisma ORM para queries relacionales y migraciones
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
  ) { }

  /**
   * ==========================================================================
   * MOTOR NATIVO CCOFACT: EMISIÓN INTEGRAL DE COMPROBANTES ELECTRÓNICOS
   * ==========================================================================
   * Endpoint oficial: POST /api/v1/ccofact/emitir
   * Diseñado para conectar cualquier ERP, POS, E-Commerce o sistema administrativo.
   */
  public async processCcofact(company: Company, dto: CcofactDocumentDto): Promise<any> {
    // Registrar tiempo inicial para auditoría de rendimiento en milisegundos
    const startTime = Date.now();

    // 1. Mapear DTO Ccofact al DTO interno de procesamiento de comprobantes
    const internalDto: CreateDocumentDto = {
      // Clave de idempotencia única para garantizar que no se duplique ante reconexiones
      idempotency_key: dto.idempotency_key,
      // Tipo de comprobante según Catálogo 01 SUNAT (01 Factura, 03 Boleta, 07 NC, 08 ND)
      document_type: dto.tipo_comprobante,
      // Serie fiscal en mayúsculas (ej. FFF1, BBB1, F001)
      series: dto.serie.toUpperCase(),
      // Moneda oficial según Catálogo 02 SUNAT (PEN = Soles, USD = Dólares)
      currency: dto.moneda || 'PEN',
      // Forma de pago (Contado o Crédito)
      payment_type: dto.forma_pago || 'Contado',
      // Tipo de documento de identidad del cliente (Catálogo 06: 6 RUC, 1 DNI)
      client_doc_type: dto.cliente.tipo_documento,
      // Número de documento de identidad del cliente
      client_doc_number: dto.cliente.numero_documento,
      // Razón social o denominación del cliente
      client_name: dto.cliente.razon_social,
      // Dirección fiscal o comercial del cliente
      client_address: dto.cliente.direccion,
      // Correo electrónico para entrega del comprobante
      client_email: dto.cliente.email,
      // Referencias tributarias para Notas de Crédito y Débito (Soporta formato plano y formato ref_documento)
      ref_document_type: dto.ref_documento?.tipo || dto.referencia_tipo_comprobante,
      ref_series: (dto.ref_documento?.serie || dto.referencia_serie) ? (dto.ref_documento?.serie || dto.referencia_serie)!.toUpperCase() : undefined,
      ref_number: dto.ref_documento?.numero || dto.referencia_numero,
      ref_reason_code: dto.ref_documento?.motivo_codigo || dto.referencia_codigo_motivo,
      ref_reason_desc: dto.ref_documento?.motivo_descripcion || dto.referencia_motivo_descripcion,
      // Mapeo detallado de cada línea de producto o servicio
      items: dto.items.map((it) => ({
        code: it.codigo || '',
        description: it.descripcion,
        unit_measure: it.unidad_medida || 'NIU',
        quantity: Number(it.cantidad),
        unit_price: Number(it.precio_unitario),
        unit_value: it.valor_unitario ? Number(it.valor_unitario) : undefined,
        igv_affectation_type: it.tipo_afectacion_igv || '10',
      })),
      // Flag de envío sincrónico inmediato a SUNAT (por defecto true)
      send_now: dto.enviar_a_sunat_inmediato !== false,
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
        razon_social: company.legal_name,
        nombre_comercial: company.commercial_name,
        direccion: company.fiscal_address,
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
   * ADAPTADOR COMPATIBLE CON MIGRACIÓN DE SISTEMAS EXISTENTES
   */
  public async processNubefact(company: Company, dto: NubefactPayloadDto): Promise<any> {
    const typeMap: Record<string, string> = {
      '1': '01',
      '2': '03',
      '3': '07',
      '4': '08',
      '01': '01',
      '03': '03',
      '07': '07',
      '08': '08',
    };
    const mappedType = typeMap[String(dto.tipo_de_comprobante)] || '01';

    const items = dto.items.map((it) => ({
      code: it.codigo || '',
      description: it.descripcion,
      unit_measure: it.unidad_de_medida || 'NIU',
      quantity: Number(it.cantidad),
      unit_price: Number(it.precio_unitario),
      unit_value: it.valor_unitario ? Number(it.valor_unitario) : undefined,
      igv_affectation_type: it.tipo_de_igv === 2 ? '20' : it.tipo_de_igv === 3 ? '30' : '10',
    }));

    const createDto: CreateDocumentDto = {
      idempotency_key: dto.idempotency_key,
      document_type: mappedType,
      series: dto.serie.toUpperCase(),
      currency: String(dto.moneda) === '2' ? 'USD' : 'PEN',
      payment_type: dto.forma_de_pago || 'Contado',
      client_doc_type: String(dto.cliente_tipo_de_documento),
      client_doc_number: dto.cliente_numero_de_documento,
      client_name: dto.cliente_denominacion,
      client_address: dto.cliente_direccion,
      client_email: dto.cliente_email,
      ref_document_type: dto.documento_que_se_modifica_tipo ? typeMap[String(dto.documento_que_se_modifica_tipo)] : undefined,
      ref_series: dto.documento_que_se_modifica_serie ? dto.documento_que_se_modifica_serie.toUpperCase() : undefined,
      ref_number: dto.documento_que_se_modifica_numero,
      ref_reason_code: dto.tipo_de_nota_de_credito
        ? String(dto.tipo_de_nota_de_credito).padStart(2, '0')
        : dto.tipo_de_nota_de_debito
          ? String(dto.tipo_de_nota_de_debito).padStart(2, '0')
          : undefined,
      ref_reason_desc: dto.motivo || dto.observaciones,
      items,
      send_now: dto.enviar_automaticamente_a_la_sunat !== false,
    };

    const doc = await this.createDocument(company, createDto);

    const baseUrl = `${process.env.APP_URL || `http://localhost:${process.env.PORT || 4001}`}/api/v1/documents/${doc.id}`;
    return {
      tipo_de_comprobante: Number(dto.tipo_de_comprobante),
      serie: doc.series,
      numero: doc.number,
      enlace: `${baseUrl}/html`,
      enlace_del_pdf: `${baseUrl}/html?format=A4`,
      enlace_del_ticket: `${baseUrl}/html?format=TICKET`,
      enlace_del_xml: `${baseUrl}/xml`,
      enlace_del_cdr: `${baseUrl}/cdr`,
      aceptada_por_sunat: doc.status.includes('ACCEPTED'),
      sunat_description: doc.sunat_description || 'Comprobante procesado',
      sunat_note: doc.sunat_notes ? doc.sunat_notes.join(', ') : '',
      sunat_responsecode: doc.sunat_response_code || '0',
      sunat_soap_error: doc.status === DocumentStatus.REJECTED ? doc.sunat_description : '',
      codigo_hash: doc.xml_digest_value,
      cadena_para_codigo_qr: doc.qr_data,
    };
  }

  /**
   * ==========================================================================
   * EMISIÓN DE COMPROBANTE CON BLOQUEO PESIMISTA ATÓMICO (CERO DOBLE FACTURACIÓN)
   * ==========================================================================
   */
  public async createDocument(company: Company, dto: CreateDocumentDto): Promise<Document> {
    // ------------------------------------------------------------------------
    // FASE 1: CHEQUEO DE IDEMPOTENCIA
    // ------------------------------------------------------------------------
    // Si el cliente envía una clave de idempotencia repetida (por ejemplo por reintento de red),
    // devolvemos el comprobante ya emitido sin incrementar correlativos ni emitir dobles comprobantes.
    if (dto.idempotency_key) {
      const existing = await this.documentRepo.findOne({
        where: { company_id: company.id, idempotency_key: dto.idempotency_key },
        relations: { items: true },
      });
      if (existing) {
        this.logger.log(`[IDEMPOTENCIA] Solicitud repetida con clave ${dto.idempotency_key}. Retornando comprobante existente ${existing.full_number}.`);
        return existing;
      }
    }

    // ------------------------------------------------------------------------
    // FASE 2: VALIDACIÓN FISCAL TRIBUTARIA SUNAT
    // ------------------------------------------------------------------------
    // Valida dígito verificador Módulo 11 de RUC, formato de DNI, montos mayores a S/ 700, etc.
    const validation = this.validator.validateDocument(dto);
    if (!validation.isValid) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Errores de validación tributaria SUNAT detectados por CCOFACT Engine',
        errors: validation.errors,
      });
    }

    // ------------------------------------------------------------------------
    // FASE 3: INICIAR TRANSACCIÓN ATÓMICA EN POSTGRESQL (Nivel de Aislamiento ACID)
    // ------------------------------------------------------------------------
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let createdDoc: Document;

    try {
      // ----------------------------------------------------------------------
      // FASE 4: BLOQUEO PESIMISTA A NIVEL DE FILA (SELECT ... FOR UPDATE)
      // ----------------------------------------------------------------------
      // Garantiza secuencialidad estricta y previene condiciones de carrera en alta concurrencia.
      const nextNumber = await this.seriesService.getNextCorrelative(
        queryRunner,
        company.id,
        dto.document_type,
        dto.series,
      );

      // Formato oficial SUNAT: 4 caracteres de serie + guion + 8 dígitos correlativos con ceros a la izquierda
      const fullNumber = `${dto.series.toUpperCase()}-${String(nextNumber).padStart(8, '0')}`;

      // ----------------------------------------------------------------------
      // FASE 5: CÁLCULO DE BASES IMPONIBLES E IMPUESTOS SEGÚN CATÁLOGO SUNAT
      // ----------------------------------------------------------------------
      const now = new Date();
      const issueDate = now.toISOString().split('T')[0];
      const issueTime = now.toTimeString().split(' ')[0];

      let totalGravada = 0;
      let totalExonerada = 0;
      let totalInafecta = 0;
      let totalIgv = 0;
      let subtotal = 0;
      let totalAmount = 0;

      const itemsToSave: DocumentItem[] = [];

      dto.items.forEach((it, idx) => {
        const qty = Number(it.quantity);
        const price = Number(it.unit_price);
        const affectation = it.igv_affectation_type || '10';

        let unitVal = it.unit_value ? Number(it.unit_value) : 0;
        let lineSubtotal = 0;
        let lineIgv = 0;
        let lineTotal = 0;

        if (affectation === '10') {
          // Gravado 18% (Operación Onerosa habitual del régimen general o MYPE tributario)
          if (!unitVal) unitVal = Number((price / 1.18).toFixed(4));
          lineSubtotal = Number((unitVal * qty).toFixed(2));
          lineTotal = Number((price * qty).toFixed(2));
          lineIgv = Number((lineTotal - lineSubtotal).toFixed(2));

          totalGravada += lineSubtotal;
          totalIgv += lineIgv;
          subtotal += lineSubtotal;
          totalAmount += lineTotal;
        } else if (affectation === '20') {
          // Exonerado (Libros, productos agrícolas específicos del Apéndice I de la Ley del IGV)
          unitVal = price;
          lineSubtotal = Number((unitVal * qty).toFixed(2));
          lineTotal = lineSubtotal;
          totalExonerada += lineSubtotal;
          subtotal += lineSubtotal;
          totalAmount += lineTotal;
        } else {
          // Inafecto u operaciones fuera del ámbito de aplicación del IGV
          unitVal = price;
          lineSubtotal = Number((unitVal * qty).toFixed(2));
          lineTotal = lineSubtotal;
          totalInafecta += lineSubtotal;
          subtotal += lineSubtotal;
          totalAmount += lineTotal;
        }

        const item = new DocumentItem();
        item.item_order = idx + 1;
        item.code = it.code || '';
        item.description = it.description;
        item.unit_measure = it.unit_measure || 'NIU';
        item.quantity = qty;
        item.unit_value = unitVal;
        item.unit_price = price;
        item.igv_affectation_type = affectation;
        item.igv_percentage = 18.0;
        item.igv_amount = lineIgv;
        item.subtotal = lineSubtotal;
        item.total = lineTotal;
        itemsToSave.push(item);
      });

      // ----------------------------------------------------------------------
      // FASE 6: PERSISTIR ENCABEZADO Y DETALLE DEL DOCUMENTO
      // ----------------------------------------------------------------------
      const doc = new Document();
      doc.company_id = company.id;
      doc.idempotency_key = dto.idempotency_key || null;
      doc.document_type = dto.document_type;
      doc.series = dto.series.toUpperCase();
      doc.number = nextNumber;
      doc.full_number = fullNumber;
      doc.issue_date = issueDate;
      doc.issue_time = issueTime;
      doc.due_date = null;
      doc.currency = dto.currency || 'PEN';
      doc.operation_type = dto.operation_type || '0101';
      doc.payment_type = dto.payment_type || 'Contado';
      doc.payment_terms = dto.payment_terms || null;
      doc.client_doc_type = dto.client_doc_type;
      doc.client_doc_number = dto.client_doc_number;
      doc.client_name = dto.client_name;
      doc.client_address = dto.client_address || '';
      doc.client_email = dto.client_email || '';
      doc.total_gravada = Number(totalGravada.toFixed(2));
      doc.total_exonerada = Number(totalExonerada.toFixed(2));
      doc.total_inafecta = Number(totalInafecta.toFixed(2));
      doc.total_gratuita = 0;
      doc.total_igv = Number(totalIgv.toFixed(2));
      doc.total_isc = 0;
      doc.total_icbper = 0;
      doc.total_descuentos = 0;
      doc.total_cargos = 0;
      doc.subtotal = Number(subtotal.toFixed(2));
      doc.total_amount = Number(totalAmount.toFixed(2));
      doc.ref_document_type = dto.ref_document_type || null;
      doc.ref_series = dto.ref_series ? dto.ref_series.toUpperCase() : null;
      doc.ref_number = dto.ref_number || null;
      doc.ref_reason_code = dto.ref_reason_code || null;
      doc.ref_reason_desc = dto.ref_reason_desc || null;
      doc.metadata = dto.metadata || null;
      doc.status = DocumentStatus.DRAFT;

      const savedDoc = await queryRunner.manager.save(doc);

      itemsToSave.forEach((it) => (it.document_id = savedDoc.id));
      await queryRunner.manager.save(DocumentItem, itemsToSave);
      savedDoc.items = itemsToSave;

      // ----------------------------------------------------------------------
      // FASE 7: CONSTRUCCIÓN DE XML UBL 2.1 Y FIRMA DIGITAL X.509
      // ----------------------------------------------------------------------
      const rawXml = this.ublBuilder.buildInvoiceXml(savedDoc, company);
      const signResult = this.xmlSigner.signXml(
        rawXml,
        company.certificate_pfx_base64,
        company.certificate_password,
      );

      savedDoc.xml_content = signResult.signedXml;
      savedDoc.xml_digest_value = signResult.digestValue;
      savedDoc.xml_signature_value = signResult.signatureValue;
      savedDoc.status = DocumentStatus.SIGNED;

      // ----------------------------------------------------------------------
      // FASE 8: GENERACIÓN DE CÓDIGO QR OFICIAL SUNAT (R.S. N° 340-2017)
      // ----------------------------------------------------------------------
      savedDoc.qr_data = this.qrService.generateQrString(
        savedDoc,
        company,
        signResult.digestValue,
      );

      await queryRunner.manager.save(Document, savedDoc);
      // Confirmar transacción atómica definitiva en PostgreSQL
      await queryRunner.commitTransaction();
      createdDoc = savedDoc;
    } catch (err: any) {
      // En caso de cualquier error, abortar completamente para evitar correlativos huérfanos
      await queryRunner.rollbackTransaction();
      this.logger.error('Fallo en la creación transaccional del comprobante', err);
      throw new BadRequestException(`No se pudo generar el comprobante: ${err.message}`);
    } finally {
      // Liberar la conexión hacia el pool de PostgreSQL
      await queryRunner.release();
    }

    // ------------------------------------------------------------------------
    // FASE 9: ENVÍO SÍNCRONO DIRECTO O ENCOLADO A SUNAT
    // ------------------------------------------------------------------------
    const shouldSendNow = dto.send_now !== false;

    if (shouldSendNow) {
      createdDoc.status = DocumentStatus.SENDING;
      await this.documentRepo.save(createdDoc);

      const sunatResult = await this.sunatSoap.sendBill(
        createdDoc,
        company,
        createdDoc.xml_content,
      );

      if (sunatResult.success) {
        createdDoc.status =
          sunatResult.notes && sunatResult.notes.length > 0
            ? DocumentStatus.ACCEPTED_OBSERVED
            : DocumentStatus.ACCEPTED;
        createdDoc.sunat_response_code = sunatResult.responseCode;
        createdDoc.sunat_description = sunatResult.description;
        createdDoc.sunat_notes = sunatResult.notes || null;
        createdDoc.cdr_xml = sunatResult.cdrXml || null;
        createdDoc.cdr_zip_base64 = sunatResult.cdrZipBase64 || null;
        createdDoc.sunat_response_at = new Date();
        await this.documentRepo.save(createdDoc);

        // Si la empresa tiene webhook configurado, encolar el evento para notificación
        if (company.webhook_url) {
          await this.jobRepo.save(
            this.jobRepo.create({
              company_id: company.id,
              document_id: createdDoc.id,
              job_type: JobType.DISPATCH_WEBHOOK,
              status: JobStatus.PENDING,
              payload: { event: 'DOCUMENT_ACCEPTED', document_id: createdDoc.id },
            }),
          );
        }
      } else if (sunatResult.isRetryableError) {
        // En caso de caída de SUNAT, encolar automáticamente en la tabla invoice_jobs
        this.logger.warn(
          `Comprobante ${createdDoc.full_number} no pudo enviarse síncronamente (${sunatResult.description}). Encolando en sistema de reintentos...`,
        );
        createdDoc.status = DocumentStatus.QUEUED;
        createdDoc.sunat_description = sunatResult.description;
        await this.documentRepo.save(createdDoc);

        await this.jobRepo.save(
          this.jobRepo.create({
            company_id: company.id,
            document_id: createdDoc.id,
            job_type: JobType.SEND_BILL,
            status: JobStatus.PENDING,
            next_run_at: new Date(Date.now() + 10000),
            payload: { full_number: createdDoc.full_number },
          }),
        );
      } else {
        // Rechazo formal por SUNAT (ej. RUC del cliente inválido o error en catálogos)
        createdDoc.status = DocumentStatus.REJECTED;
        createdDoc.sunat_response_code = sunatResult.responseCode;
        createdDoc.sunat_description = sunatResult.description;
        createdDoc.sunat_notes = sunatResult.notes || null;
        createdDoc.cdr_xml = sunatResult.cdrXml || null;
        createdDoc.cdr_zip_base64 = sunatResult.cdrZipBase64 || null;
        createdDoc.sunat_response_at = new Date();
        await this.documentRepo.save(createdDoc);

        if (company.webhook_url) {
          await this.jobRepo.save(
            this.jobRepo.create({
              company_id: company.id,
              document_id: createdDoc.id,
              job_type: JobType.DISPATCH_WEBHOOK,
              status: JobStatus.PENDING,
              payload: { event: 'DOCUMENT_REJECTED', document_id: createdDoc.id },
            }),
          );
        }
      }
    } else {
      // Envío asíncrono solicitado explícitamente por el cliente
      createdDoc.status = DocumentStatus.QUEUED;
      await this.documentRepo.save(createdDoc);

      await this.jobRepo.save(
        this.jobRepo.create({
          company_id: company.id,
          document_id: createdDoc.id,
          job_type: JobType.SEND_BILL,
          status: JobStatus.PENDING,
          payload: { full_number: createdDoc.full_number },
        }),
      );
    }

    return createdDoc;
  }

  /**
   * Obtener un comprobante por ID
   */
  public async getDocumentById(companyId: string, id: string): Promise<Document> {
    const doc = await this.documentRepo.findOne({
      where: { id, company_id: companyId },
      relations: { items: true, company: true },
    });
    if (!doc) {
      throw new NotFoundException(`Comprobante con id ${id} no encontrado`);
    }
    return doc;
  }

  /**
   * Obtener un comprobante por ID público (acceso directo para descarga de XML, CDR o visualización)
   */
  public async getDocumentByIdPublic(id: string): Promise<Document> {
    const doc = await this.documentRepo.findOne({
      where: { id },
      relations: { items: true, company: true },
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
  ): Promise<{ data: Document[]; total: number }> {
    const query = this.documentRepo
      .createQueryBuilder('doc')
      .leftJoinAndSelect('doc.items', 'items')
      .where('doc.company_id = :companyId', { companyId });

    if (filters.document_type) {
      query.andWhere('doc.document_type = :dt', { dt: filters.document_type });
    }
    if (filters.status) {
      query.andWhere('doc.status = :st', { st: filters.status });
    }
    if (filters.series) {
      query.andWhere('doc.series = :series', { series: filters.series.toUpperCase() });
    }

    query.orderBy('doc.created_at', 'DESC');
    query.skip(filters.offset || 0);
    query.take(filters.limit || 50);

    const [data, total] = await query.getManyAndCount();
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

    doc.status = DocumentStatus.SENDING;
    await this.documentRepo.save(doc);

    // Si el comprobante reporta estar en proceso en SUNAT (0140), consultamos el CDR
    let sunatResult: SunatResponse;
    if (doc.sunat_response_code?.includes('0140') || doc.sunat_description?.includes('0140')) {
      this.logger.log(`[RETRY] Comprobante ${doc.full_number} en estado 0140 (En Proceso). Consultando CDR con getStatusCdr...`);
      sunatResult = await this.sunatSoap.getStatusCdr(company, doc.document_type, doc.series, doc.number);
      if (!sunatResult.success && !sunatResult.cdrZipBase64 && !sunatResult.responseCode?.includes('0140')) {
        sunatResult = await this.sunatSoap.sendBill(doc, company, doc.xml_content);
      }
    } else {
      sunatResult = await this.sunatSoap.sendBill(doc, company, doc.xml_content);
      if (sunatResult.responseCode?.includes('0140') || sunatResult.description?.includes('0140')) {
        this.logger.log(`[RETRY] SUNAT retornó 0140 para ${doc.full_number}. Verificando si el CDR ya fue emitido...`);
        const cdrCheck = await this.sunatSoap.getStatusCdr(company, doc.document_type, doc.series, doc.number);
        if (cdrCheck.success || cdrCheck.cdrZipBase64) {
          sunatResult = cdrCheck;
        }
      }
    }

    if (sunatResult.success) {
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
    } else {
      doc.status = sunatResult.isRetryableError ? DocumentStatus.QUEUED : DocumentStatus.REJECTED;
      doc.sunat_response_code = sunatResult.responseCode;
      doc.sunat_description = sunatResult.description;
    }

    return this.documentRepo.save(doc);
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

    if (sunatResult.success || sunatResult.cdrZipBase64) {
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
    } else {
      doc.sunat_response_code = sunatResult.responseCode;
      doc.sunat_description = sunatResult.description;
      if (!sunatResult.isRetryableError) {
        doc.status = DocumentStatus.REJECTED;
      }
    }

    return this.documentRepo.save(doc);
  }

  /**
   * Eliminar físicamente un comprobante del sistema CCOFACT
   * Limpia items dependientes, trabajos en cola y el registro maestro del comprobante
   */
  public async deleteDocument(companyId: string, id: string): Promise<{ success: boolean; message: string }> {
    const doc = await this.documentRepo.findOne({
      where: { id, company_id: companyId },
      relations: { items: true },
    });

    if (!doc) {
      throw new NotFoundException(`Comprobante con ID ${id} no encontrado en la empresa`);
    }

    const fullNumber = doc.full_number;
    const docId = doc.id;

    // 1. Limpiar colas de contingencia e historial de reintentos
    await this.jobRepo.delete({ document_id: doc.id });

    // 2. Eliminar items asociados si existen
    if (doc.items && doc.items.length > 0) {
      await this.dataSource.getRepository(DocumentItem).remove(doc.items);
    }

    // 3. Eliminar el comprobante
    await this.documentRepo.remove(doc);

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
    const doc = await this.documentRepo.findOne({
      where: {
        company_id: companyId,
        series: series.toUpperCase(),
        number: Number(number),
      },
      relations: { items: true },
    });

    if (!doc) {
      this.logger.warn(`Intento de eliminar comprobante no existente: ${series}-${number}`);
      return {
        success: false,
        message: `Comprobante ${series}-${number} no encontrado en el sistema.`,
      };
    }

    // Limpiar trabajos en cola asociados
    await this.jobRepo.delete({ document_id: doc.id });

    // Limpiar items
    if (doc.items && doc.items.length > 0) {
      await this.dataSource.getRepository(DocumentItem).remove(doc.items);
    }

    // Eliminar comprobante
    await this.documentRepo.remove(doc);

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

    doc.status = DocumentStatus.ANULADO;
    doc.metadata = {
      ...(doc.metadata || {}),
      anulado_at: new Date().toISOString(),
      motivo_anulacion: motivo,
    };

    this.logger.log(`[ANULACIÓN] Comprobante ${doc.full_number} marcado como ANULADO. Motivo: ${motivo}`);
    return this.documentRepo.save(doc);
  }

  /**
   * PROCEDIMIENTO OFICIAL SUNAT: ANULACIÓN MEDIANTE NOTA DE CRÉDITO (Catálogo 09 Motivo 01)
   * Resolución de Superintendencia N.° 097-2012/SUNAT y Catálogo N.° 09 SUNAT
   *
   * 1. Comprueba que el comprobante original exista y pertenezca a la empresa.
   * 2. Si el comprobante ya está ANULADO, arroja excepción.
   * 3. Determina la serie legal de Nota de Crédito:
   *    - Si la original era Factura ('01') -> Serie FC01
   *    - Si la original era Boleta ('03')  -> Serie BC01
   * 4. Construye el DTO de la Nota de Crédito con:
   *    - document_type: '07'
   *    - ref_document_type: doc.document_type
   *    - ref_series: doc.series
   *    - ref_number: doc.number
   *    - ref_reason_code: '01' (Catálogo 09: Anulación de la operación)
   *    - ref_reason_desc: motivo || 'ANULACION DE LA OPERACION'
   *    - Mismos ítems, montos y cliente del comprobante original.
   * 5. Emite la Nota de Crédito con firma digital X.509 y envío a SUNAT por SOAP.
   * 6. Actualiza el comprobante original a status = DocumentStatus.ANULADO,
   *    registrando la referencia cruzada de la Nota de Crédito generada.
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

    // Determinar la serie legal de la Nota de Crédito según normativa SUNAT
    const ncSeries = originalDoc.document_type === '01' ? 'FC01' : 'BC01';

    // Generar DTO para la emisión de la Nota de Crédito
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
      ref_reason_code: '01', // Catálogo 09 SUNAT: Anulación de la operación
      ref_reason_desc: (motivo || 'ANULACION DE LA OPERACION').toUpperCase(),
      items:
        originalDoc.items && originalDoc.items.length > 0
          ? originalDoc.items.map((it) => ({
              code: it.code || 'ITEM',
              description: it.description || 'CONSUMO',
              unit_measure: it.unit_measure || 'NIU',
              quantity: Number(it.quantity) || 1,
              unit_price: Number(it.unit_price) || Number(originalDoc.total_amount),
              igv_affectation_type: it.igv_affectation_type || '10',
            }))
          : [
              {
                code: 'ITEM',
                description: 'CONSUMO',
                unit_measure: 'NIU',
                quantity: 1,
                unit_price: Number(originalDoc.total_amount) || 10,
                igv_affectation_type: '10',
              },
            ],
      send_now: true,
    };

    // Emitir la Nota de Crédito con bloqueo pesimista y firma X.509
    const creditNoteDoc = await this.createDocument(company, ncDto);

    // Actualizar el estado del comprobante original a ANULADO
    originalDoc.status = DocumentStatus.ANULADO;
    originalDoc.metadata = {
      ...(originalDoc.metadata || {}),
      anulacion_legal: {
        tipo: 'NOTA_DE_CREDITO',
        nota_credito_id: creditNoteDoc.id,
        nota_credito_numero: creditNoteDoc.full_number,
        motivo: ncDto.ref_reason_desc,
        fecha_anulacion: new Date().toISOString(),
      },
    };
    await this.documentRepo.save(originalDoc);

    this.logger.log(
      `[ANULACIÓN LEGAL SUNAT] Comprobante ${originalDoc.full_number} anulado formalmente con Nota de Crédito ${creditNoteDoc.full_number}`,
    );

    return {
      success: true,
      comprobante_original: {
        id: originalDoc.id,
        full_number: originalDoc.full_number,
        status: originalDoc.status,
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
   * Usado por Control Finanzas y sistemas externos al eliminar una venta facturada
   */
  public async anularFiscalBySeriesAndNumber(
    company: Company,
    series: string,
    number: number,
    motivo: string = 'ANULACION DE LA OPERACION',
  ) {
    const doc = await this.documentRepo.findOne({
      where: {
        company_id: company.id,
        series: series.toUpperCase(),
        number: Number(number),
      },
      relations: { items: true },
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

    if (dto.client_name) doc.client_name = dto.client_name;
    if (dto.client_doc_type) doc.client_doc_type = dto.client_doc_type;
    if (dto.client_doc_number) doc.client_doc_number = dto.client_doc_number;
    if (dto.client_address !== undefined) doc.client_address = dto.client_address;
    if (dto.client_email !== undefined) doc.client_email = dto.client_email;
    if (dto.currency) doc.currency = dto.currency;
    if (dto.payment_type) doc.payment_type = dto.payment_type;

    if (dto.items && dto.items.length > 0) {
      let totalGravada = 0;
      let totalExonerada = 0;
      let totalInafecta = 0;
      let totalIgv = 0;
      let subtotal = 0;
      let totalAmount = 0;

      // Eliminar items antiguos si existen
      if (doc.items && doc.items.length > 0) {
        await this.dataSource.getRepository(DocumentItem).remove(doc.items);
      }

      const newItems: DocumentItem[] = [];

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

        const item = new DocumentItem();
        item.document_id = doc.id;
        item.item_order = idx + 1;
        item.code = it.code || '';
        item.description = it.description;
        item.unit_measure = it.unit_measure || 'NIU';
        item.quantity = qty;
        item.unit_value = unitVal;
        item.unit_price = price;
        item.igv_affectation_type = affectation;
        item.igv_percentage = 18.0;
        item.igv_amount = lineIgv;
        item.subtotal = lineSubtotal;
        item.total = lineTotal;
        newItems.push(item);
      });

      doc.total_gravada = totalGravada;
      doc.total_exonerada = totalExonerada;
      doc.total_inafecta = totalInafecta;
      doc.total_igv = totalIgv;
      doc.subtotal = subtotal;
      doc.total_amount = totalAmount;

      await this.dataSource.getRepository(DocumentItem).save(newItems);
      doc.items = newItems;
    }

    const savedDoc = await this.documentRepo.save(doc);

    // Si se solicitó enviar inmediatamente tras la actualización
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
   * Procedimiento profesional estándar de SUNAT (Resolución 097-2012):
   * 1. Emite Nota de Crédito (Catálogo 09 Motivo 01: Anulación de la operación) ante SUNAT.
   * 2. Emite de inmediato el nuevo comprobante corregido con nueva serie/correlativo.
   * 3. Registra referencias cruzadas en metadata para total auditoría tributaria.
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
    originalDoc.metadata = {
      ...(originalDoc.metadata || {}),
      rectificado: {
        fecha: new Date().toISOString(),
        nota_credito: anulacionResult.nota_credito.full_number,
        nuevo_comprobante: emisionResult.comprobante?.numero_completo,
      },
    };
    await this.documentRepo.save(originalDoc);

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
