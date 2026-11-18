import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as forge from 'node-forge';

export interface CertificateMetadata {
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: Date;
  validTo: Date;
  daysRemaining: number;
  isExpired: boolean;
  isValid: boolean;
}

/**
 * ============================================================================
 * CCOFACT PRO - AUDITOR Y PARSER DE CERTIFICADOS DIGITALES X.509
 * ============================================================================
 * Inspecciona archivos PKCS#12 (.pfx / .p12), valida contraseña,
 * extrae fechas oficiales de vigencia y datos del contribuyente/emisor.
 */
@Injectable()
export class CertificateParserService {
  private readonly logger = new Logger(CertificateParserService.name);

  public parsePfx(pfxBase64: string, password: string = ''): CertificateMetadata {
    try {
      const pfxDer = forge.util.decode64(pfxBase64);
      const p12Asn1 = forge.asn1.fromDer(pfxDer);
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password || '');

      let targetCert: forge.pki.Certificate | null = null;

      for (const safeContent of p12.safeContents) {
        for (const safeBag of safeContent.safeBags) {
          if (safeBag.cert) {
            targetCert = safeBag.cert;
            break;
          }
        }
        if (targetCert) break;
      }

      if (!targetCert) {
        throw new BadRequestException('El archivo .pfx no contiene un certificado X.509 reconocible');
      }

      // Extraer campos del Subject (Titular)
      const subjectAttrs = targetCert.subject?.attributes || [];
      const cnAttr = subjectAttrs.find((a: any) => a.name === 'commonName' || a.shortName === 'CN');
      const oAttr = subjectAttrs.find((a: any) => a.name === 'organizationName' || a.shortName === 'O');
      const subject = (cnAttr?.value || oAttr?.value || 'Titular no especificado').toString();

      // Extraer campos del Issuer (Entidad Emisora)
      const issuerAttrs = targetCert.issuer?.attributes || [];
      const issuerCn = issuerAttrs.find((a: any) => a.name === 'commonName' || a.shortName === 'CN');
      const issuerO = issuerAttrs.find((a: any) => a.name === 'organizationName' || a.shortName === 'O');
      const issuer = (issuerO?.value || issuerCn?.value || 'Entidad Certificadora').toString();

      const validFrom = targetCert.validity.notBefore;
      const validTo = targetCert.validity.notAfter;
      const now = new Date();
      const diffTime = validTo.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const isExpired = daysRemaining <= 0;

      return {
        subject,
        issuer,
        serialNumber: targetCert.serialNumber,
        validFrom,
        validTo,
        daysRemaining,
        isExpired,
        isValid: !isExpired,
      };
    } catch (err: any) {
      if (err.message && (err.message.includes('password') || err.message.includes('MAC'))) {
        throw new BadRequestException('Contraseña del certificado .pfx incorrecta');
      }
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`No se pudo decodificar el certificado .pfx: ${err.message}`);
    }
  }
}

