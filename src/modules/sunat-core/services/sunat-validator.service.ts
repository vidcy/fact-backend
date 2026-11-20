import { Injectable } from '@nestjs/common';
import { CreateDocumentDto } from '../../documents/dto/create-document.dto';

/**
 * ============================================================================
 * CCOFACT PRO - SERVICIO DE VALIDACIÓN TRIBUTARIA SUNAT
 * CORPORACIÓN CCOPLEX
 * ============================================================================
 * Implementa las reglas del Manual de Normas y Validación de Comprobantes de Pago
 * Electrónicos de SUNAT:
 * - Algoritmo Módulo 11 para RUCs peruanos.
 * - Validación de DNI según RENIEC (8 dígitos numéricos).
 * - RS N° 193-2020/SUNAT: Boletas de venta que superen S/ 700.00 requieren DNI o documento.
 * - Comprobante Tipo 01 (Factura): Solo puede ser emitido a receptores con RUC (Tipo 6).
 * - Comprobante Tipo 07/08 (Notas de Crédito/Débito): Requiere documento de referencia y motivo (Catálogo 09).
 */
@Injectable()
export class SunatValidatorService {
  /**
   * Validación del Algoritmo Módulo 11 oficial de SUNAT
   * Factores de ponderación: [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
   */
  public isValidRuc(ruc: string): boolean {
    if (!ruc || ruc.length !== 11 || !/^\d{11}$/.test(ruc)) {
      return false;
    }

    const firstTwo = ruc.substring(0, 2);
    // Tipos de personas reconocidas por SUNAT:
    // 10: Persona Natural sin negocio / con negocio
    // 15: Persona Natural extranjera
    // 17: Persona Natural no domiciliada
    // 20: Persona Jurídica (S.A.C., S.R.L., S.A., etc.)
    if (!['10', '15', '17', '20'].includes(firstTwo)) {
      return false;
    }

    const factors = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(ruc.charAt(i), 10) * factors[i];
    }

    const remainder = sum % 11;
    let checkDigit = 11 - remainder;
    if (checkDigit === 10) checkDigit = 0;
    if (checkDigit === 11) checkDigit = 1;

    return checkDigit === parseInt(ruc.charAt(10), 10);
  }

  // Alias para interoperabilidad de llamadas
  public validateRuc(ruc: string): boolean {
    return this.isValidRuc(ruc);
  }

  /**
   * Valida formato de DNI peruano (8 dígitos numéricos sin letras ni símbolos)
   */
  public isValidDni(dni: string): boolean {
    return !!dni && /^\d{8}$/.test(dni);
  }

  // Alias para interoperabilidad de llamadas
  public validateDni(dni: string): boolean {
    return this.isValidDni(dni);
  }

  /**
   * Valida el payload de emisión según normativas tributarias de SUNAT
   */
  public validateDocument(dto: CreateDocumentDto): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Validación de Comprobante Tipo 01 (Factura)
    if (dto.document_type === '01') {
      if (dto.client_doc_type !== '6') {
        errors.push('Las Facturas (01) solo pueden ser emitidas a clientes con RUC (tipo de documento 6).');
      }
      if (!this.isValidRuc(dto.client_doc_number)) {
        errors.push(`El RUC del cliente '${dto.client_doc_number}' es inválido ante el algoritmo Módulo 11 de SUNAT.`);
      }
      if (!dto.series.toUpperCase().startsWith('F')) {
        errors.push(`La serie de una Factura debe iniciar con la letra 'F' (ej. F001), se envió: ${dto.series}`);
      }
    }

    // 2. Validación de Comprobante Tipo 03 (Boleta de Venta)
    if (dto.document_type === '03') {
      if (!dto.series.toUpperCase().startsWith('B')) {
        errors.push(`La serie de una Boleta debe iniciar con la letra 'B' (ej. B001), se envió: ${dto.series}`);
      }

      // Regla de Boletas > S/ 700.00
      let totalEstimado = 0;
      dto.items.forEach((it) => {
        totalEstimado += Number(it.unit_price) * Number(it.quantity);
      });

      if (totalEstimado > 700) {
        if (dto.client_doc_type === '0' || !dto.client_doc_number || dto.client_doc_number.trim() === '') {
          errors.push(
            `Según la R.S. N° 193-2020/SUNAT, las boletas con importe total mayor a S/ 700.00 requieren identificar obligatoriamente al cliente con DNI, RUC o pasaporte. Total: S/ ${totalEstimado.toFixed(2)}`,
          );
        }
      }

      if (dto.client_doc_type === '1' && !this.isValidDni(dto.client_doc_number)) {
        errors.push(`El DNI '${dto.client_doc_number}' debe contener exactamente 8 dígitos numéricos.`);
      }
    }

    // 3. Validación de Notas de Crédito (07) y Débito (08)
    if (dto.document_type === '07' || dto.document_type === '08') {
      const isCredit = dto.document_type === '07';
      const refType = dto.ref_document_type;
      const refSeries = dto.ref_series ? dto.ref_series.toUpperCase().trim() : '';

      if (!refType || !refSeries || !dto.ref_number) {
        errors.push('Las Notas de Crédito y Débito exigen los campos del comprobante de referencia (ref_document_type, ref_series, ref_number).');
      } else {
        if (!['01', '03'].includes(refType)) {
          errors.push(`El tipo de comprobante que modifica debe ser '01' (Factura) o '03' (Boleta). Se envió: ${refType}`);
        }

        // Validación de correspondencia de series normada por SUNAT:
        // Si modifica Factura (01), la serie de la nota DEBE iniciar con 'F' (ej. FC01, FN01)
        // Si modifica Boleta (03), la serie de la nota DEBE iniciar con 'B' (ej. BC01, BN01)
        const noteSeries = dto.series ? dto.series.toUpperCase().trim() : '';
        if (refType === '01' && !noteSeries.startsWith('F')) {
          errors.push(`La serie de una Nota que modifica una Factura (01) debe iniciar con la letra 'F' (ej. FC01, FN01). Se envió: ${noteSeries}`);
        }
        if (refType === '03' && !noteSeries.startsWith('B')) {
          errors.push(`La serie de una Nota que modifica una Boleta (03) debe iniciar con la letra 'B' (ej. BC01, BN01). Se envió: ${noteSeries}`);
        }
      }

      if (!dto.ref_reason_code) {
        errors.push(`Debe especificar el código de motivo según ${isCredit ? 'Catálogo 09' : 'Catálogo 10'} de SUNAT (ref_reason_code).`);
      } else {
        const code = String(dto.ref_reason_code).padStart(2, '0');
        if (isCredit) {
          const validCodes = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13'];
          if (!validCodes.includes(code)) {
            errors.push(`Código de motivo de Nota de Crédito '${dto.ref_reason_code}' no válido en Catálogo 09 de SUNAT (01 a 13).`);
          }
        }
      }

      // Si modifica Factura (01), el cliente debe tener RUC (6)
      if (refType === '01') {
        if (dto.client_doc_type !== '6') {
          errors.push('Una Nota de Crédito que modifica una Factura debe consignar a un cliente con RUC (tipo de documento 6).');
        }
        if (!this.isValidRuc(dto.client_doc_number)) {
          errors.push(`El RUC del cliente '${dto.client_doc_number}' en la Nota de Crédito es inválido ante el algoritmo Módulo 11 de SUNAT.`);
        }
      }
    }

    // 4. Validación de Guía de Remisión Remitente (09)
    if (dto.document_type === '09') {
      const guideSeries = dto.series ? dto.series.toUpperCase().trim() : '';
      if (!guideSeries.startsWith('T')) {
        errors.push(`La serie de una Guía de Remisión Remitente (09) debe iniciar con la letra 'T' (ej. T001, T002). Se envió: ${guideSeries}`);
      }
    }

    // 4. Validación de Líneas de Detalle
    if (!dto.items || dto.items.length === 0) {
      errors.push('El comprobante debe contener al menos un ítem o servicio en el detalle.');
    } else {
      dto.items.forEach((it, idx) => {
        if (it.quantity <= 0) {
          errors.push(`Ítem ${idx + 1}: La cantidad debe ser un valor mayor a cero.`);
        }
        if (it.unit_price < 0) {
          errors.push(`Ítem ${idx + 1}: El precio unitario no puede ser negativo.`);
        }
        if (!it.description || it.description.trim() === '') {
          errors.push(`Ítem ${idx + 1}: La descripción del producto o servicio no puede estar vacía.`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
