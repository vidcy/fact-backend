import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsNumber, IsBoolean, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DocumentItemDto {
  @ApiPropertyOptional({ example: 'PRD001' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({ example: 'Desarrollo de Software a Medida' })
  @Transform(({ value, obj }) => (value || obj.name || 'Detalle del producto').trim())
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiPropertyOptional({ example: 'NIU', default: 'NIU' })
  @IsOptional()
  @IsString()
  unit_measure?: string;

  @ApiProperty({ example: 1 })
  @Transform(({ value, obj }) => Number(value !== undefined ? value : (obj.qty ?? 1)))
  @IsNumber()
  quantity: number;

  @ApiProperty({ example: 100.0, description: 'Precio unitario con impuestos incluidos' })
  @Transform(({ value, obj }) => Number(value !== undefined ? value : (obj.price ?? obj.salePrice ?? 0)))
  @IsNumber()
  unit_price: number;

  @ApiPropertyOptional({ example: 84.75, description: 'Valor unitario sin impuestos' })
  @IsOptional()
  @IsNumber()
  unit_value?: number;

  @ApiPropertyOptional({ example: '10', default: '10', description: '10 Gravado, 20 Exonerado, 30 Inafecto' })
  @IsOptional()
  @IsString()
  igv_affectation_type?: string;
}

export class CreateDocumentDto {
  @ApiPropertyOptional({ description: 'Llave de idempotencia única para prevenir doble facturación' })
  @IsOptional()
  @IsString()
  idempotency_key?: string;

  @ApiProperty({ example: '01', description: '01 Factura, 03 Boleta, 07 Nota de Crédito, 08 Nota de Débito, 09 Guía de Remisión' })
  @IsNotEmpty()
  @IsIn(['01', '03', '07', '08', '09'])
  document_type: string;

  @ApiProperty({ example: 'F001', description: 'Serie del comprobante (F001, B001, FC01, BC01, etc.)' })
  @IsNotEmpty()
  @IsString()
  series: string;

  @ApiPropertyOptional({ example: '2026-11-22', description: 'Fecha de emisión en formato YYYY-MM-DD (hora de Perú)' })
  @IsOptional()
  @IsString()
  issue_date?: string;

  @ApiPropertyOptional({ example: '21:30:00', description: 'Hora de emisión en formato HH:mm:ss (hora de Perú)' })
  @IsOptional()
  @IsString()
  issue_time?: string;

  @ApiPropertyOptional({ example: 'PEN', default: 'PEN' })
  @IsOptional()
  @IsIn(['PEN', 'USD'])
  currency?: string;

  @ApiPropertyOptional({ example: '0101', default: '0101' })
  @IsOptional()
  @IsString()
  operation_type?: string;

  @ApiPropertyOptional({ example: 'Contado', default: 'Contado' })
  @IsOptional()
  @IsString()
  payment_type?: string;

  @ApiPropertyOptional({ description: 'Cuotas de crédito si aplica' })
  @IsOptional()
  payment_terms?: any;

  // Cliente
  @ApiProperty({ example: '6', description: '6 RUC, 1 DNI, 4 Carnet Ext., 7 Pasaporte, 0 Sin Documento' })
  @IsNotEmpty()
  @IsString()
  client_doc_type: string;

  @ApiProperty({ example: '20123456789' })
  @IsNotEmpty()
  @IsString()
  client_doc_number: string;

  @ApiProperty({ example: 'CORPORACION EJEMPLO S.A.C.' })
  @IsNotEmpty()
  @IsString()
  client_name: string;

  @ApiPropertyOptional({ example: 'Av. Las Begonias 450, San Isidro, Lima' })
  @IsOptional()
  @IsString()
  client_address?: string;

  @ApiPropertyOptional({ example: 'contacto@ejemplo.com' })
  @IsOptional()
  @IsString()
  client_email?: string;

  // Referencias para NC y ND
  @ApiPropertyOptional({ example: '01' })
  @IsOptional()
  @IsString()
  ref_document_type?: string;

  @ApiPropertyOptional({ example: 'F001' })
  @IsOptional()
  @IsString()
  ref_series?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  ref_number?: number;

  @ApiPropertyOptional({ example: '01', description: 'Catálogo 09 SUNAT (01 Anulación de la operación, etc.)' })
  @IsOptional()
  @IsString()
  ref_reason_code?: string;

  @ApiPropertyOptional({ example: 'ANULACION DE LA OPERACION' })
  @IsOptional()
  @IsString()
  ref_reason_desc?: string;

  @ApiProperty({ type: [DocumentItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentItemDto)
  items: DocumentItemDto[];

  @ApiPropertyOptional({ default: true, description: 'Si es true envía inmediatamente por SOAP. Si es false o falla comunicación, lo procesa la cola' })
  @IsOptional()
  @IsBoolean()
  send_now?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: any;

  @ApiPropertyOptional({ description: 'Datos oficiales de traslado para Guía de Remisión (09)' })
  @IsOptional()
  guia_datos?: any;
}
