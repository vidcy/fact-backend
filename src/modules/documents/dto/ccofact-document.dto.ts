import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsIn,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * ============================================================================
 * CCOFACT PRO - CORPORACIÓN CCOPLEX
 * DTO de Ítems del Comprobante Electrónico UBL 2.1
 * ============================================================================
 * Representa cada línea de detalle (producto o servicio) facturado.
 * Cumple con los requerimientos de la Resolución de Superintendencia SUNAT.
 */
export class CcofactItemDto {
  @ApiPropertyOptional({
    example: 'SERV-001',
    description: 'Código interno del producto o servicio asignado por el negocio',
  })
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiProperty({
    example: 'Desarrollo de Software y Módulo de Facturación Electrónica CCOFACT',
    description: 'Descripción detallada del producto o servicio vendido',
  })
  @IsNotEmpty({ message: 'La descripción del ítem es obligatoria' })
  @IsString()
  descripcion: string;

  @ApiPropertyOptional({
    example: 'NIU',
    default: 'NIU',
    description:
      'Unidad de medida según Catálogo N° 03 de SUNAT (NIU: Unidades, ZZ: Servicios, BX: Cajas, KGM: Kilos, DZN: Docena)',
  })
  @IsOptional()
  @IsString()
  unidad_medida?: string;

  @ApiProperty({
    example: 1,
    description: 'Cantidad de unidades vendidas (mayor a 0)',
  })
  @IsNumber({}, { message: 'La cantidad debe ser un número válido' })
  @Min(0.0001, { message: 'La cantidad debe ser mayor a cero' })
  cantidad: number;

  @ApiProperty({
    example: 118.0,
    description: 'Precio de venta unitario final (con IGV incluido para operaciones gravadas)',
  })
  @IsNumber({}, { message: 'El precio unitario debe ser un valor numérico' })
  @Min(0, { message: 'El precio unitario no puede ser negativo' })
  precio_unitario: number;

  @ApiPropertyOptional({
    example: 100.0,
    description: 'Valor unitario sin impuestos (si se omite, CCOFACT lo calcula automáticamente deduciendo el IGV)',
  })
  @IsOptional()
  @IsNumber()
  valor_unitario?: number;

  @ApiPropertyOptional({
    example: '10',
    default: '10',
    description:
      'Código de Tipo de Afectación al IGV (Catálogo N° 07 SUNAT): ' +
      '10 = Gravado - Operación Onerosa (18%), ' +
      '20 = Exonerado - Operación Onerosa (Apéndice I y II Ley IGV), ' +
      '30 = Inafecto - Operación Onerosa, ' +
      '40 = Exportación',
  })
  @IsOptional()
  @IsString()
  tipo_afectacion_igv?: string;
}

/**
 * ============================================================================
 * DTO de Datos del Cliente / Adquiriente
 * ============================================================================
 */
export class CcofactClienteDto {
  @ApiProperty({
    example: '6',
    description:
      'Tipo de documento según Catálogo N° 06 SUNAT (6: RUC, 1: DNI, 4: Carnet de Extranjería, 7: Pasaporte, 0: Sin Documento)',
  })
  @IsNotEmpty({ message: 'El tipo de documento del cliente es obligatorio' })
  @IsString()
  tipo_documento: string;

  @ApiProperty({
    example: '20601234567',
    description: 'Número de RUC (11 dígitos), DNI (8 dígitos) o documento de identidad',
  })
  @IsNotEmpty({ message: 'El número de documento del cliente es obligatorio' })
  @IsString()
  numero_documento: string;

  @ApiProperty({
    example: 'EMPRESA INDUSTRIAL LIMA S.A.C.',
    description: 'Razón Social o Nombre Completo del cliente',
  })
  @IsNotEmpty({ message: 'La razón social o denominación del cliente es obligatoria' })
  @IsString()
  razon_social: string;

  @ApiPropertyOptional({
    example: 'Av. Javier Prado Este 4200, Surco, Lima',
    description: 'Dirección fiscal o comercial del cliente',
  })
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({
    example: 'contabilidad@empresacliente.com',
    description: 'Correo electrónico para envío automático del comprobante',
  })
  @IsOptional()
  @IsString()
  email?: string;
}

/**
 * ============================================================================
 * DTO para Documento de Referencia (Notas de Crédito y Débito)
 * ============================================================================
 */
export class CcofactRefDocumentoDto {
  @ApiPropertyOptional({ example: '01', description: '01: Factura, 03: Boleta' })
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional({ example: 'F001' })
  @IsOptional()
  @IsString()
  serie?: string;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber()
  numero?: number;

  @ApiPropertyOptional({ example: '01', description: 'Código del motivo según Catálogo SUNAT 09 o 10' })
  @IsOptional()
  @IsString()
  motivo_codigo?: string;

  @ApiPropertyOptional({ example: 'Anulación de la operación' })
  @IsOptional()
  @IsString()
  motivo_descripcion?: string;
}

/**
 * ============================================================================
 * CCOFACT PRO - PAYLOAD PRINCIPAL DE EMISIÓN DE COMPROBANTES
 * ============================================================================
 * Este objeto es enviado por cualquier sistema cliente (ERP, POS, Web, CRM, etc.)
 * a través de POST /api/v1/ccofact/emitir.
 */
export class CcofactDocumentDto {
  @ApiPropertyOptional({
    example: 'orden_compra_987654',
    description:
      'Llave de idempotencia única generada por su sistema (ej. UUID o ID de venta). ' +
      'Garantiza que ante cortes de red o múltiples clics NUNCA se duplique un comprobante ni se salten correlativos.',
  })
  @IsOptional()
  @IsString()
  idempotency_key?: string;

  @ApiProperty({
    example: '01',
    description:
      'Tipo de Comprobante (Catálogo 01 SUNAT): ' +
      '01 = Factura Electrónica, ' +
      '03 = Boleta de Venta Electrónica, ' +
      '07 = Nota de Crédito Electrónica, ' +
      '08 = Nota de Débito Electrónica, ' +
      '09 = Guía de Remisión Electrónica (Remitente)',
  })
  @IsNotEmpty({ message: 'El tipo de comprobante es obligatorio' })
  @IsIn(['01', '03', '07', '08', '09'], { message: 'El tipo de comprobante debe ser 01, 03, 07, 08 u 09' })
  tipo_comprobante: string;

  @ApiProperty({
    example: 'F001',
    description:
      'Serie del comprobante: ' +
      'Facturas: F001 a F999, ' +
      'Boletas: B001 a B999, ' +
      'Notas de Crédito para Factura: FC01 a FC99 o F001, ' +
      'Notas de Crédito para Boleta: BC01 a BC99 o B001',
  })
  @IsNotEmpty({ message: 'La serie es obligatoria' })
  @IsString()
  serie: string;

  @ApiPropertyOptional({
    example: '2026-11-22',
    description: 'Fecha de emisión en formato YYYY-MM-DD (hora de Perú)',
  })
  @IsOptional()
  @IsString()
  fecha_emision?: string;

  @ApiPropertyOptional({
    example: '21:30:00',
    description: 'Hora de emisión en formato HH:mm:ss (hora de Perú)',
  })
  @IsOptional()
  @IsString()
  hora_emision?: string;

  @ApiPropertyOptional({
    example: '2026-11-22',
    description: 'Alias de fecha_emision en formato YYYY-MM-DD',
  })
  @IsOptional()
  @IsString()
  issue_date?: string;

  @ApiPropertyOptional({
    example: '21:30:00',
    description: 'Alias de hora_emision en formato HH:mm:ss',
  })
  @IsOptional()
  @IsString()
  issue_time?: string;

  @ApiPropertyOptional({
    example: 'PEN',
    default: 'PEN',
    description: 'Moneda (Catálogo N° 02 SUNAT): PEN = Soles Peruanos, USD = Dólares Americanos, EUR = Euros',
  })
  @IsOptional()
  @IsIn(['PEN', 'USD', 'EUR'])
  moneda?: string;

  @ApiPropertyOptional({
    example: 'Contado',
    default: 'Contado',
    description: 'Forma de pago: Contado o Crédito',
  })
  @IsOptional()
  @IsString()
  forma_pago?: string;

  @ApiProperty({
    type: CcofactClienteDto,
    description: 'Datos del cliente o receptor tributario',
  })
  @ValidateNested()
  @Type(() => CcofactClienteDto)
  cliente: CcofactClienteDto;

  @ApiProperty({
    type: [CcofactItemDto],
    description: 'Listado de ítems, productos o servicios que componen el comprobante',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CcofactItemDto)
  items: CcofactItemDto[];

  // Objeto de referencia para sistemas como control-Finanzas
  @ApiPropertyOptional({
    type: CcofactRefDocumentoDto,
    description: 'Objeto de referencia del comprobante modificado (utilizado por sistemas ERP/POS como Control Finanzas)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CcofactRefDocumentoDto)
  ref_documento?: CcofactRefDocumentoDto;

  // Campos específicos para Notas de Crédito (07) y Notas de Débito (08)
  @ApiPropertyOptional({
    example: '01',
    description: 'Tipo de comprobante que modifica (01: Factura, 03: Boleta). Requerido para Notas de Crédito/Débito.',
  })
  @IsOptional()
  @IsString()
  referencia_tipo_comprobante?: string;

  @ApiPropertyOptional({
    example: 'F001',
    description: 'Serie del comprobante que modifica. Requerido para Notas de Crédito/Débito.',
  })
  @IsOptional()
  @IsString()
  referencia_serie?: string;

  @ApiPropertyOptional({
    example: 12,
    description: 'Número correlativo del comprobante que modifica. Requerido para Notas de Crédito/Débito.',
  })
  @IsOptional()
  @IsNumber()
  referencia_numero?: number;

  @ApiPropertyOptional({
    example: '01',
    description:
      'Código de motivo según Catálogo 09 SUNAT para Notas de Crédito: ' +
      '01 = Anulación de la operación, ' +
      '02 = Anulación por error en el RUC, ' +
      '03 = Corrección por error en la descripción, ' +
      '04 = Descuento global, ' +
      '05 = Descuento por ítem, ' +
      '06 = Devolución total, ' +
      '07 = Devolución por ítem, ' +
      '08 = Bonificación, ' +
      '09 = Disminución en el valor',
  })
  @IsOptional()
  @IsString()
  referencia_codigo_motivo?: string;

  @ApiPropertyOptional({
    example: 'ANULACION TOTAL DE LA OPERACION POR ERROR EN DETALLE',
    description: 'Descripción explicativa del motivo de emisión de la nota',
  })
  @IsOptional()
  @IsString()
  referencia_motivo_descripcion?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Envío directo y sincrónico a SUNAT (true) o encolado transaccional en segundo plano (false). ' +
      'Por defecto true para recibir el CDR al instante.',
  })
  @IsOptional()
  @IsBoolean()
  enviar_a_sunat_inmediato?: boolean;

  @ApiPropertyOptional({
    description: 'Datos oficiales de traslado para Guía de Remisión (09): motivo, modalidad, partida, llegada, transportista, conductor, bultos y peso',
  })
  @IsOptional()
  guia_datos?: any;
}
