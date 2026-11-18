import { IsNotEmpty, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NubefactItemDto {
  @ApiPropertyOptional({ example: 'PRD-01' })
  @IsOptional()
  codigo?: string;

  @ApiProperty({ example: 'Desarrollo de Software a Medida' })
  @IsNotEmpty()
  descripcion: string;

  @ApiPropertyOptional({ example: 'NIU', default: 'NIU' })
  @IsOptional()
  unidad_de_medida?: string;

  @ApiProperty({ example: 1 })
  @IsNotEmpty()
  cantidad: number;

  @ApiProperty({ example: 118.00 })
  @IsNotEmpty()
  precio_unitario: number;

  @ApiPropertyOptional({ example: 100.00 })
  @IsOptional()
  valor_unitario?: number;

  @ApiPropertyOptional({ example: 1, description: '1: Gravado (18%), 2: Exonerado, 3: Inafecto' })
  @IsOptional()
  tipo_de_igv?: number;

  @ApiPropertyOptional({ example: 100.00 })
  @IsOptional()
  subtotal?: number;

  @ApiPropertyOptional({ example: 118.00 })
  @IsOptional()
  total?: number;
}

export class NubefactPayloadDto {
  @ApiProperty({ example: 'generar_comprobante', description: 'operacion: generar_comprobante | anular_comprobante' })
  @IsNotEmpty()
  operacion: string;

  @ApiProperty({ example: 1, description: '1 Factura, 2 Boleta, 3 Nota de Crédito, 4 Nota de Débito' })
  @IsNotEmpty()
  tipo_de_comprobante: number | string;

  @ApiProperty({ example: 'FFF1' })
  @IsNotEmpty()
  serie: string;

  @ApiPropertyOptional({ example: 1, description: 'Si se omite, el sistema asigna el siguiente correlativo atómicamente' })
  @IsOptional()
  numero?: number;

  @ApiPropertyOptional({ example: 1, default: 1, description: '1 Soles (PEN), 2 Dólares (USD)' })
  @IsOptional()
  moneda?: number | string;

  @ApiPropertyOptional({ example: 18.0 })
  @IsOptional()
  porcentaje_de_igv?: number;

  @ApiPropertyOptional({ example: 'Contado' })
  @IsOptional()
  forma_de_pago?: string;

  // Cliente
  @ApiProperty({ example: 6, description: '6 RUC, 1 DNI, 4 Carnet Ext., 7 Pasaporte, 0 Sin Doc' })
  @IsNotEmpty()
  cliente_tipo_de_documento: number | string;

  @ApiProperty({ example: '20601234567' })
  @IsNotEmpty()
  cliente_numero_de_documento: string;

  @ApiProperty({ example: 'CLIENTE EMPRESA S.A.C.' })
  @IsNotEmpty()
  cliente_denominacion: string;

  @ApiPropertyOptional({ example: 'Av. Las Begonias 450, San Isidro, Lima' })
  @IsOptional()
  cliente_direccion?: string;

  @ApiPropertyOptional({ example: 'facturas@cliente.pe' })
  @IsOptional()
  cliente_email?: string;

  // Referencias para NC y ND
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  documento_que_se_modifica_tipo?: number;

  @ApiPropertyOptional({ example: 'FFF1' })
  @IsOptional()
  documento_que_se_modifica_serie?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  documento_que_se_modifica_numero?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  tipo_de_nota_de_credito?: number;

  @ApiPropertyOptional({ example: 1, description: '1 Intereses por mora, 2 Aumento en el valor, 3 Penalidades' })
  @IsOptional()
  tipo_de_nota_de_debito?: number;

  @ApiPropertyOptional({ example: 'ANULACION DE LA OPERACION' })
  @IsOptional()
  motivo?: string;

  @ApiPropertyOptional({ example: 'Observaciones / Motivo de la nota' })
  @IsOptional()
  observaciones?: string;

  @ApiProperty({ type: [NubefactItemDto] })
  @IsArray()
  items: NubefactItemDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  enviar_automaticamente_a_la_sunat?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  idempotency_key?: string;
}
