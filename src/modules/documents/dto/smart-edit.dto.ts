import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsNumber } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentItemDto } from './create-document.dto';

export class SmartEditDto {
  @ApiPropertyOptional({ example: '2026-11-22', description: 'Nueva fecha de emisión en formato YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  issue_date?: string;

  @ApiProperty({ example: '6', description: '6 RUC, 1 DNI, 0 Sin documento' })
  @Transform(({ value }) => (value && String(value).trim()) || '0')
  @IsNotEmpty()
  @IsString()
  client_doc_type: string;

  @ApiProperty({ example: '20601234567' })
  @Transform(({ value }) => (value && String(value).trim()) || '00000000')
  @IsNotEmpty()
  @IsString()
  client_doc_number: string;

  @ApiProperty({ example: 'EMPRESA CLIENTE S.A.C.' })
  @Transform(({ value }) => (value && String(value).trim()) || 'CLIENTES VARIOS')
  @IsNotEmpty()
  @IsString()
  client_name: string;

  @ApiPropertyOptional({ example: 'Av. Las Begonias 450, San Isidro' })
  @IsOptional()
  @IsString()
  client_address?: string;

  @ApiPropertyOptional({ example: 'facturacion@empresa.com' })
  @IsOptional()
  @IsString()
  client_email?: string;

  @ApiPropertyOptional({ example: 'PEN' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'Contado' })
  @IsOptional()
  @IsString()
  payment_type?: string;

  @ApiProperty({ type: [DocumentItemDto] })
  @IsArray()
  @Transform(({ value }) => {
    if (!Array.isArray(value)) return [];
    return value.map((it: any) => ({
      ...it,
      code: it.code || 'PROD',
      description: String(it.description || it.name || 'Detalle del ítem').trim(),
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.unit_price !== undefined ? it.unit_price : (it.price ?? it.salePrice ?? 0)),
      unit_measure: it.unit_measure || it.unit || 'NIU',
      igv_affectation_type: it.igv_affectation_type || it.igvAffectation || '10',
    }));
  })
  @ValidateNested({ each: true })
  @Type(() => DocumentItemDto)
  items: DocumentItemDto[];

  @ApiPropertyOptional({ description: 'Motivo personalizado si se desea forzar una descripción tributaria específica' })
  @IsOptional()
  @IsString()
  custom_reason?: string;
}

export class ManualNoteDto {
  @ApiProperty({ example: '07', description: '07 Nota de Crédito, 08 Nota de Débito' })
  @IsNotEmpty()
  @IsString()
  note_type: '07' | '08';

  @ApiProperty({ example: '01', description: 'Código del Catálogo 09 (NC) o Catálogo 10 (ND)' })
  @IsNotEmpty()
  @IsString()
  reason_code: string;

  @ApiProperty({ example: 'ANULACION DE LA OPERACION' })
  @Transform(({ value, obj }) => value || obj.reason_text || obj.reasonText || 'ANULACION DE LA OPERACION')
  @IsNotEmpty()
  @IsString()
  reason_description: string;

  @ApiPropertyOptional({ example: 100.0, description: 'Monto específico del ajuste. Si no se envía se calcula de los ítems o del 100%' })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ type: [DocumentItemDto] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => {
    if (!Array.isArray(value)) return undefined;
    const sanitized = value
      .filter((it: any) => it && (Number(it.quantity || it.returnQty || 0) > 0) && (Number(it.unit_price || it.price || 0) > 0))
      .map((it: any) => ({
        code: it.code || 'PROD',
        description: it.description || it.name || 'Detalle del ítem',
        quantity: Number(it.quantity || it.returnQty || 1),
        unit_price: Number(it.unit_price || it.price || 0),
        unit_measure: it.unit_measure || it.unit || 'NIU',
        igv_affectation_type: it.igv_affectation_type || it.igvAffectation || '10',
      }));
    return sanitized.length > 0 ? sanitized : undefined;
  })
  @ValidateNested({ each: true })
  @Type(() => DocumentItemDto)
  items?: DocumentItemDto[];
}
