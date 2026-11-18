import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  Header,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiSecurity, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { CcofactDocumentDto } from './dto/ccofact-document.dto';
import { NubefactPayloadDto } from './dto/nubefact-payload.dto';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import type { Company } from '@prisma/client';
import { ConsultasService } from '../sunat-core/services/consultas.service';

/**
 * ============================================================================
 * CCOFACT PRO - CONTROLADOR PRINCIPAL DE COMPROBANTES ELECTRÓNICOS SUNAT
 * CORPORACIÓN CCOPLEX
 * ============================================================================
 */
@ApiTags('CCOFACT Engine - Comprobantes Electrónicos')
@Controller('api/v1')
export class DocumentsController {
  constructor(
    private documentsService: DocumentsService,
    private consultasService: ConsultasService,
  ) { }

  /**
   * ENDPOINT OFICIAL SOBERANO CCOFACT:
   * Emisión universal de Facturas, Boletas, Notas de Crédito y Débito
   */
  @Post('ccofact/emitir')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Emitir Comprobante Electrónico (API Oficial CCOFACT)',
    description:
      'Procesa la emisión inmediata con firma digital X.509, validación de reglas SUNAT, ' +
      'reserva atómica con bloqueo pesimista ACID y entrega de CDR, QR oficial y enlaces PDF/Ticket.',
  })
  @ApiResponse({
    status: 200,
    description: 'Comprobante emitido y procesado exitosamente por CCOFACT',
  })
  @ApiResponse({
    status: 400,
    description: 'Error de validación tributaria o sintaxis en el comprobante',
  })
  @ApiResponse({
    status: 401,
    description: 'API Key inválida o no proporcionada en la cabecera x-api-key',
  })
  async emitirCcofact(
    @CurrentCompany() company: Company,
    @Body() dto: CcofactDocumentDto,
  ) {
    return this.documentsService.processCcofact(company, dto);
  }

  /**
   * ESTADO DEL MOTOR CCOFACT PRO Y EMPRESA EMISORA
   */
  @Get('ccofact/status')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Verificar estado del motor CCOFACT y credenciales de la empresa',
  })
  async getStatus(@CurrentCompany() company: Company) {
    const series = await this.documentsService.getCompanySeries(company.id);
    return {
      online: true,
      engine: 'CCOFACT PRO Enterprise',
      version: '2.0.0-ENTERPRISE',
      company: {
        id: company.id,
        ruc: company.ruc,
        razon_social: company.razon_social,
        nombre_comercial: company.nombre_comercial || company.razon_social,
        direccion: company.direccion,
        env_mode: company.env_mode,
        certificado_valido: Boolean(company.certificate_pfx_base64),
        usuario_sol: company.sol_user,
        series_activas: series.map((s) => ({
          tipo: s.document_type,
          serie: s.series,
          ultimo_numero: s.current_number,
        })),
      },
    };
  }

  /**
   * MODIFICAR COMPROBANTE EN BORRADOR O RECHAZADO
   */
  @Put('documents/:id')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Modificar comprobante (en borrador o con error previo)',
    description: 'Actualiza cliente, ítems o condiciones si el comprobante aún no fue aceptado con CDR por SUNAT',
  })
  async updateDocument(
    @CurrentCompany() company: Company,
    @Param('id') id: string,
    @Body() dto: Partial<CreateDocumentDto>,
  ) {
    return this.documentsService.updateDocument(company, id, dto);
  }

  /**
   * RECTIFICAR FACTURA O BOLETA ACEPTADA CON NOTA DE CRÉDITO Y REEMPLAZO
   */
  @Post('documents/:id/rectificar')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Rectificar/Modificar Factura o Boleta aceptada por SUNAT',
    description: 'Anula el comprobante original con Nota de Crédito oficial (Catálogo 09 Motivo 01) y emite el nuevo comprobante corregido.',
  })
  async rectificarDocument(
    @CurrentCompany() company: Company,
    @Param('id') id: string,
    @Body() body: { nuevo_comprobante: CcofactDocumentDto; motivo_anulacion?: string },
  ) {
    return this.documentsService.rectificarDocument(
      company,
      id,
      body.nuevo_comprobante,
      body.motivo_anulacion,
    );
  }

  /**
   * ENDPOINT CANÓNICO REST:
   */
  @Post('documents')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Emitir Comprobante (REST Canónico)',
    description: 'Genera UBL 2.1, firma digitalmente con X.509, calcula código QR y envía a SUNAT',
  })
  async create(
    @CurrentCompany() company: Company,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documentsService.createDocument(company, dto);
  }

  /**
   * ADAPTADOR COMPATIBLE CON MIGRACIONES LEGACY:
   */
  @Post('nubefact')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Endpoint de Compatibilidad de Migración Legacy',
    description: 'Permite conectar sistemas que usaban el formato JSON legacy cambiando solo la URL del host.',
  })
  async handleNubefact(
    @CurrentCompany() company: Company,
    @Body() dto: NubefactPayloadDto,
  ) {
    return this.documentsService.processNubefact(company, dto);
  }

  @Get('documents')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Listar comprobantes emitidos con filtros avanzados' })
  @ApiQuery({ name: 'document_type', required: false, example: '01' })
  @ApiQuery({ name: 'status', required: false, example: 'ACCEPTED' })
  @ApiQuery({ name: 'series', required: false, example: 'F001' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  async list(
    @CurrentCompany() company: Company,
    @Query('document_type') documentType?: string,
    @Query('status') status?: string,
    @Query('series') series?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.documentsService.getDocuments(company.id, {
      document_type: documentType,
      status,
      series,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
  }

  @Get('documents/:id')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Obtener detalle completo de un comprobante por ID' })
  async getOne(@CurrentCompany() company: Company, @Param('id') id: string) {
    return this.documentsService.getDocumentById(company.id, id);
  }

  @Get('documents/:id/xml')
  @ApiOperation({ summary: 'Descargar XML UBL 2.1 firmado digitalmente con certificado X.509' })
  @Header('Content-Type', 'application/xml')
  async downloadXml(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.documentsService.getDocumentByIdPublic(id);
    const company = doc.company;
    const fileName = `${company?.ruc || 'FACT'}-${doc.document_type}-${doc.series}-${String(doc.number).padStart(8, '0')}.xml`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(doc.xml_content);
  }

  @Get('documents/:id/cdr')
  @ApiOperation({ summary: 'Descargar CDR XML de SUNAT (Constancia de Recepción Oficial)' })
  @Header('Content-Type', 'application/xml')
  async downloadCdr(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.documentsService.getDocumentByIdPublic(id);
    const company = doc.company;
    const fileName = `R-${company?.ruc || 'FACT'}-${doc.document_type}-${doc.series}-${String(doc.number).padStart(8, '0')}.xml`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(doc.cdr_xml || '<error>No hay CDR disponible para este comprobante</error>');
  }

  @Get('documents/:id/html')
  @ApiOperation({ summary: 'Visualizar representación impresa oficial en HTML vectorial con QR' })
  @ApiQuery({ name: 'format', required: false, enum: ['A4', 'TICKET'] })
  async viewHtml(
    @Param('id') id: string,
    @Query('format') format: 'A4' | 'TICKET' = 'A4',
    @Res() res: Response,
  ) {
    const doc = await this.documentsService.getDocumentByIdPublic(id);
    const html = await this.documentsService.generateHtmlPreview(doc.company, id, format);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Post('documents/:id/retry')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Reintentar envío manual a SUNAT de un comprobante pendiente o fallido' })
  async retry(@CurrentCompany() company: Company, @Param('id') id: string) {
    return this.documentsService.retryDocument(company, id);
  }

  @Post('documents/:id/consultar-cdr')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Consultar CDR oficial en SUNAT (billConsultService getStatusCdr)',
    description: 'Consulta a SUNAT si el comprobante ya fue procesado y recupera el CDR XML oficial, ideal para resolver Error 0140 (En Proceso)',
  })
  async consultarCdr(@CurrentCompany() company: Company, @Param('id') id: string) {
    return this.documentsService.consultarCdrSunat(company, id);
  }

  /**
   * ELIMINAR COMPROBANTE POR SERIE Y NÚMERO CORRELATIVO
   * Usado por sistemas externos como Control Finanzas al anular o borrar una venta
   */
  @Delete('documents/by-series-number/:series/:number')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Eliminar comprobante por Serie y Número',
    description: 'Permite a sistemas externos sincronizar la eliminación de una venta o boleta por su correlativo',
  })
  async deleteBySeriesAndNumber(
    @CurrentCompany() company: Company,
    @Param('series') series: string,
    @Param('number') number: number,
    @Query('anular_fiscal') anularFiscal?: string,
    @Body('motivo') motivo?: string,
  ) {
    if (anularFiscal === 'true') {
      return this.documentsService.anularFiscalBySeriesAndNumber(company, series, number, motivo);
    }
    return this.documentsService.deleteBySeriesAndNumber(company.id, series, number);
  }

  /**
   * ELIMINAR COMPROBANTE POR ID
   * Permite eliminar boletas o facturas del sistema de facturación electrónica
   */
  @Delete('documents/:id')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Eliminar comprobante electrónico por UUID',
    description: 'Elimina de forma permanente el comprobante, sus items y colas asociadas en CCOFACT',
  })
  async deleteDocument(
    @CurrentCompany() company: Company,
    @Param('id') id: string,
    @Query('anular_fiscal') anularFiscal?: string,
    @Body('motivo') motivo?: string,
  ) {
    if (anularFiscal === 'true') {
      return this.documentsService.anularWithCreditNote(company, id, motivo);
    }
    return this.documentsService.deleteDocument(company.id, id);
  }

  /**
   * ANULACIÓN FISCAL OFICIAL CONFORME A LEY SUNAT (Catálogo 09 Motivo 01)
   * Emite automáticamente una Nota de Crédito (FC01 o BC01) que anula la operación ante SUNAT
   */
  @Post('documents/:id/anular-fiscal')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Anulación Legal con Nota de Crédito (Ley SUNAT)',
    description:
      'Procedimiento oficial de la SUNAT: emite la Nota de Crédito correspondiente (Catálogo 09 Motivo 01), ' +
      'la firma digitalmente con X.509, la envía a SUNAT y marca el comprobante como ANULADO.',
  })
  async anularFiscal(
    @CurrentCompany() company: Company,
    @Param('id') id: string,
    @Body('motivo') motivo?: string,
  ) {
    return this.documentsService.anularWithCreditNote(company, id, motivo);
  }

  /**
   * ANULACIÓN FISCAL OFICIAL POR SERIE Y NÚMERO (Para Control Finanzas y ERPs)
   */
  @Post('documents/by-series-number/:series/:number/anular-fiscal')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Anulación Legal por Serie y Número (Sistemas Externos)',
    description: 'Permite a Control Finanzas u otros sistemas anular legalmente ante SUNAT por serie y correlativo',
  })
  async anularFiscalBySeriesNumber(
    @CurrentCompany() company: Company,
    @Param('series') series: string,
    @Param('number') number: number,
    @Body('motivo') motivo?: string,
  ) {
    return this.documentsService.anularFiscalBySeriesAndNumber(company, series, number, motivo);
  }

  /**
   * ANULAR COMPROBANTE FORMALMENTE POR ID
   */
  @Post('documents/:id/anular')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Anular formalmente un comprobante en CCOFACT' })
  async anularDocument(
    @CurrentCompany() company: Company,
    @Param('id') id: string,
    @Body('motivo') motivo?: string,
  ) {
    return this.documentsService.anularDocument(company.id, id, motivo);
  }

  /**
   * ANULAR O DAR DE BAJA COMPROBANTE POR SERIE Y NÚMERO
   */
  @Post('documents/anular')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Anular comprobante por Serie y Número' })
  async anularByPayload(
    @CurrentCompany() company: Company,
    @Body() body: { serie?: string; numero?: number; motivo?: string },
  ) {
    if (!body.serie || !body.numero) {
      throw new BadRequestException('Serie y número son obligatorios para anular el comprobante');
    }
    return this.documentsService.deleteBySeriesAndNumber(company.id, body.serie, body.numero);
  }

  // Consultas públicas de RUC & DNI
  @Get('consultas/ruc/:ruc')
  @ApiOperation({ summary: 'Consultar validez y datos de RUC con algoritmo Módulo 11' })
  async consultarRuc(@Param('ruc') ruc: string) {
    return this.consultasService.consultarRuc(ruc);
  }

  @Get('consultas/dni/:dni')
  @ApiOperation({ summary: 'Consultar datos de DNI' })
  async consultarDni(@Param('dni') dni: string) {
    return this.consultasService.consultarDni(dni);
  }
}
