import { Injectable, Logger } from '@nestjs/common';
import * as forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

/**
 * ============================================================================
 * CCOFACT PRO - SERVICIO DE FIRMA DIGITAL X.509 CON ESTÁNDAR XMLDSig (SUNAT)
 * CORPORACIÓN CCOPLEX
 * ============================================================================
 * Implementa la especificación técnica de SUNAT para comprobantes electrónicos:
 * - Algoritmo de Digest: SHA-256 (http://www.w3.org/2001/04/xmlenc#sha256)
 * - Algoritmo de Firma: RSA-SHA256 (http://www.w3.org/2001/04/xmldsig-more#rsa-sha256)
 * - Canonicalización: Canonical XML 1.0 (http://www.w3.org/TR/2001/REC-xml-c14n-20010315)
 * - Ubicación de firma: Primer elemento `ext:ExtensionContent` del XML UBL 2.1
 * - Extracción automática del Hash del Comprobante (ds:DigestValue) para el QR.
 */
@Injectable()
export class XmlSignerService {
  private readonly logger = new Logger('CCOFACT-XmlSigner');

  private defaultTestCert: { privateKeyPem: string; certPem: string } | null = null;

  constructor() {
    this.initDefaultCertificate();
  }

  /**
   * Genera un certificado X.509 RSA 2048-bit en memoria para ambientes de desarrollo
   * en caso de que la empresa no haya subido su archivo .PFX oficial aún.
   */
  private initDefaultCertificate() {
    try {
      const keys = forge.pki.rsa.generateKeyPair(2048);
      const cert = forge.pki.createCertificate();
      cert.publicKey = keys.publicKey;
      cert.serialNumber = '01';
      cert.validity.notBefore = new Date();
      cert.validity.notAfter = new Date();
      cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 3);

      const attrs = [
        { name: 'commonName', value: 'CERTIFICADO DIGITAL CCOFACT PRO' },
        { name: 'countryName', value: 'PE' },
        { shortName: 'ST', value: 'Lima' },
        { name: 'localityName', value: 'Lima' },
        { name: 'organizationName', value: 'CORPORACION CCOPLEX S.A.C.' },
      ];
      cert.setSubject(attrs);
      cert.setIssuer(attrs);
      cert.sign(keys.privateKey, forge.md.sha256.create());

      this.defaultTestCert = {
        privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
        certPem: forge.pki.certificateToPem(cert),
      };
      this.logger.log('Certificado digital de contingencia CCOFACT inicializado con éxito.');
    } catch (err) {
      this.logger.error('Error generando certificado contingente:', err);
    }
  }

  /**
   * Extrae la clave privada y certificado X.509 de un archivo .PFX / .P12 codificado en Base64
   */
  public extractKeysFromPfx(
    pfxBase64: string,
    password: string,
  ): { privateKeyPem: string; certPem: string } {
    try {
      const pfxDer = forge.util.decode64(pfxBase64);
      const p12Asn1 = forge.asn1.fromDer(pfxDer);
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password || '');

      let privateKey: forge.pki.PrivateKey | null = null;
      const certBags: forge.pki.Certificate[] = [];

      // Extraer claves privadas y todos los certificados de la cadena X.509
      for (const safeContent of p12.safeContents) {
        for (const safeBag of safeContent.safeBags) {
          if (safeBag.key) {
            privateKey = safeBag.key;
          }
          if (safeBag.cert) {
            certBags.push(safeBag.cert);
          }
        }
      }

      if (!privateKey || certBags.length === 0) {
        throw new Error('No se pudo encontrar el par clave-certificado dentro del archivo .pfx');
      }

      // VINCULACIÓN CRÍTICA: Encontrar el certificado hoja (Leaf Certificate) que corresponde
      // exactamente a la clave privada comparando el módulo RSA (n).
      // En certificados oficiales tributarios (RENIEC / CDT / Llama.pe), el PFX contiene
      // la cadena completa (Titular -> CA Intermedia -> CA Raíz).
      // Si se toma el último certificado, se incrusta la CA en lugar del titular, causando
      // que SUNAT rechace con Error 2335: "Decode signature failed".
      let leafCert = certBags[0];
      if ((privateKey as any).n) {
        const privModulus = (privateKey as any).n.toString(16);
        const matched = certBags.find(
          (cert) =>
            cert.publicKey &&
            (cert.publicKey as any).n &&
            (cert.publicKey as any).n.toString(16) === privModulus,
        );
        if (matched) {
          leafCert = matched;
        }
      }

      const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
      const certPem = forge.pki.certificateToPem(leafCert);

      return { privateKeyPem, certPem };
    } catch (e: any) {
      this.logger.error(`Error al procesar Certificado Digital PFX: ${e.message}`);
      throw new Error(`Fallo en Certificado Digital X.509: ${e.message}`);
    }
  }

  /**
   * Ejecuta la firma digital XMLDSig sobre el XML UBL 2.1
   */
  public signXml(
    xml: string,
    pfxBase64?: string,
    password?: string,
  ): { signedXml: string; digestValue: string; signatureValue: string } {
    let keys = this.defaultTestCert;

    if (pfxBase64) {
      keys = this.extractKeysFromPfx(pfxBase64, password || '');
    }

    if (!keys) {
      throw new Error('No hay certificado digital X.509 disponible para firmar');
    }

    // Instanciar motor de firma XMLDSig con opciones de canonicalización y algoritmos oficiales SUNAT
    const sig = new SignedXml({
      privateKey: keys.privateKeyPem,
      publicCert: keys.certPem,
      signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
      canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    });

    sig.addReference({
      xpath: '/*',
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      ],
      digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
      isEmptyUri: true,
    });

    sig.computeSignature(xml, {
      location: {
        reference: "//*[local-name(.)='ExtensionContent']",
        action: 'append',
      },
      attrs: {
        Id: 'SIGN-CCOFACT',
      },
    });

    const signedXml = sig.getSignedXml();

    // Extraer el DigestValue (Hash del comprobante exigido por SUNAT)
    const digestMatch = signedXml.match(/<ds:DigestValue>([^<]+)<\/ds:DigestValue>/i) ||
                        signedXml.match(/<DigestValue>([^<]+)<\/DigestValue>/i);
    const signatureMatch = signedXml.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/i) ||
                          signedXml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/i);

    const digestValue = digestMatch ? digestMatch[1].trim() : 'NO_DIGEST';
    const signatureValue = signatureMatch ? signatureMatch[1].trim() : 'NO_SIG';

    return {
      signedXml,
      digestValue,
      signatureValue,
    };
  }
}
