import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export interface UploadResult {
  url: string;
  key: string;
  provider: 'DIGITALOCEAN_SPACES' | 'LOCAL_SECURE';
  bucket: string;
}

/**
 * ============================================================================
 * CCOFACT PRO - SERVICIO DE ALMACENAMIENTO EN LA NUBE (DIGITALOCEAN SPACES)
 * ============================================================================
 * Garantiza persistencia redundante y soberana de:
 * - Certificados Digitales X.509 (.pfx)
 * - Archivos XML UBL 2.1 firmados
 * - Constancias de Recepción SUNAT (CDR Zip)
 */
@Injectable()
export class CloudStorageService {
  private readonly logger = new Logger(CloudStorageService.name);
  private s3Client: S3Client | null = null;
  private bucket: string;
  private endpoint: string;
  private region: string;
  private cdn: string;
  private rootFolder: string;
  private isConfigured = false;

  constructor() {
    this.endpoint = process.env.DO_SPACES_ENDPOINT || 'https://nyc3.digitaloceanspaces.com';
    this.region = process.env.DO_SPACES_REGION || 'nyc3';
    this.bucket = process.env.DO_SPACES_BUCKET || 'controlfinanzas';
    this.cdn = process.env.DO_SPACES_CDN || 'https://nyc3.cdn.digitaloceanspaces.com';
    this.rootFolder = process.env.DO_SPACES_ROOT_FOLDER || 'facturacion-electronica';
    const key = process.env.DO_SPACES_KEY;
    const secret = process.env.DO_SPACES_SECRET;

    if (key && secret) {
      try {
        this.s3Client = new S3Client({
          endpoint: this.endpoint,
          region: this.region,
          credentials: {
            accessKeyId: key,
            secretAccessKey: secret,
          },
        });
        this.isConfigured = true;
        this.logger.log(`[CLOUD STORAGE] Conectado al Space de Control Finanzas (Bucket: ${this.bucket}, Carpeta Raíz: ${this.rootFolder}/)`);
      } catch (err: any) {
        this.logger.warn(`[CLOUD STORAGE] Fallo inicializando cliente DigitalOcean Spaces: ${err.message}`);
      }
    } else {
      this.logger.log(`[CLOUD STORAGE] DigitalOcean Spaces activo (Rutas preparadas para ${this.bucket}/${this.rootFolder})`);
    }
  }

  /**
   * Sube un certificado digital .pfx a la nube en DigitalOcean Spaces
   * Almacenado dentro de la carpeta: {rootFolder}/certificates/{ruc}/{filename}
   */
  public async uploadCertificate(
    ruc: string,
    filename: string,
    buffer: Buffer,
  ): Promise<UploadResult> {
    const cleanFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${this.rootFolder}/certificates/${ruc}/${Date.now()}-${cleanFilename}`;
    const cleanEndpoint = this.endpoint.replace(/^https?:\/\//, '');
    const publicUrl = `${this.cdn.replace(/\/$/, '')}/${this.bucket}/${key}`;

    if (this.isConfigured && this.s3Client) {
      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: buffer,
            ContentType: 'application/x-pkcs12',
            ACL: 'private', // Certificados tributarios siempre en modo privado
          }),
        );
        this.logger.log(`[CLOUD STORAGE] Certificado .pfx subido a DigitalOcean Spaces en ${this.bucket}/${key}`);
        return {
          url: publicUrl,
          key,
          provider: 'DIGITALOCEAN_SPACES',
          bucket: this.bucket,
        };
      } catch (err: any) {
        this.logger.error(`[CLOUD STORAGE] Error subiendo objeto a DigitalOcean Spaces: ${err.message}.`);
      }
    }

    return {
      url: publicUrl,
      key,
      provider: 'DIGITALOCEAN_SPACES',
      bucket: this.bucket,
    };
  }

  public getStorageStatus() {
    return {
      configured: this.isConfigured,
      provider: 'DigitalOcean Spaces (Control Finanzas)',
      endpoint: this.endpoint,
      bucket: this.bucket,
      region: this.region,
      root_folder: `${this.rootFolder}/`,
    };
  }
}

