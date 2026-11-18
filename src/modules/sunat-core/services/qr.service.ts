import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { Document } from '../../../entities/document.entity';
import { Company } from '../../../entities/company.entity';

/**
 * ============================================================================
 * CCOFACT PRO - SERVICIO DE GENERACIÓN DE CÓDIGO QR OFICIAL SUNAT
 * CORPORACIÓN CCOPLEX
 * ============================================================================
 * Cumple con la Resolución de Superintendencia N° 340-2017/SUNAT (Anexo V).
 * Estructura de la cadena obligatoria separada por pipes (|):
 * 1. RUC del Emisor
 * 2. Tipo de Comprobante (01, 03, 07, 08)
 * 3. Serie
 * 4. Número correlativo
 * 5. Total IGV
 * 6. Total Importe
 * 7. Fecha de Emisión (YYYY-MM-DD)
 * 8. Tipo de Documento de Identidad del Adquiriente (Catálogo 06)
 * 9. Número de Documento de Identidad del Adquiriente
 * 10. Código Hash (ds:DigestValue extraído de la firma digital X.509)
 */
@Injectable()
export class QrService {
  /**
   * Construye la cadena formateada oficial que codifica el código QR
   */
  public generateQrString(doc: Document, company: Company, digestValue: string): string {
    const paddedNumber = String(doc.number).padStart(8, '0');
    const igvFormatted = Number(doc.total_igv).toFixed(2);
    const totalFormatted = Number(doc.total_amount).toFixed(2);

    return [
      company.ruc,
      doc.document_type,
      doc.series,
      paddedNumber,
      igvFormatted,
      totalFormatted,
      doc.issue_date,
      doc.client_doc_type,
      doc.client_doc_number,
      digestValue,
    ].join('|');
  }

  /**
   * Genera la imagen bidimensional del QR en formato Data URL PNG Base64
   * para su incrustación directa en el PDF vectorial o Ticket POS térmico
   */
  public async generateQrBase64Image(qrData: string): Promise<string> {
    try {
      return await QRCode.toDataURL(qrData, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 200,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });
    } catch (e) {
      return '';
    }
  }
}
