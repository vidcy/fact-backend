import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Company } from '@prisma/client';
import { SeriesService } from '../series/series.service';
import { CloudStorageService } from './services/cloud-storage.service';
import { CertificateParserService } from './services/certificate-parser.service';

export enum EnvMode {
  BETA = 'BETA',
  PRODUCCION = 'PRODUCCION',
}

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seriesService: SeriesService,
    private readonly cloudStorage: CloudStorageService,
    private readonly certificateParser: CertificateParserService,
  ) {}

  /**
   * Inicializa la empresa matriz de demostración (Corporación Ccoplex S.A.C.) si no existe.
   */
  public async seedDefaultCompany(): Promise<Company> {
    const ruc = '20600000001';
    let company = await this.prisma.company.findUnique({ where: { ruc } });
    if (!company) {
      company = await this.prisma.company.create({
        data: {
          ruc,
          razon_social: 'CORPORACIÓN CCOPLEX S.A.C.',
          nombre_comercial: 'CCOFACT PRO - ENTERPRISE EDITION',
          direccion: 'AV. JAVIER PRADO ESTE 4200, PISO 14, SANTIAGO DE SURCO, LIMA',
          departamento: 'LIMA',
          provincia: 'LIMA',
          distrito: 'SANTIAGO DE SURCO',
          ubigeo: '150140',
          email: 'facturacion@ccoplex.com',
          telefono: '+51 987654321',
          sol_user: 'MODDATOS',
          sol_pass: 'MODDATOS',
          env_mode: EnvMode.BETA,
          api_key: 'fact_demo_key_pro_2026',
          is_active: true,
        },
      });
      await this.seriesService.initDefaultSeries(company.id);
    }
    return company;
  }

  /**
   * Obtiene la entidad de una empresa por su UUID.
   */
  public async getCompanyById(id: string): Promise<Company> {
    const comp = await this.prisma.company.findUnique({
      where: { id },
      include: { branches: true, series_list: true },
    });
    if (!comp) {
      throw new NotFoundException(`Empresa con ID ${id} no encontrada en CCOFACT.`);
    }
    return comp;
  }

  /**
   * Obtiene una empresa por su RUC (11 dígitos).
   */
  public async getCompanyByRuc(ruc: string): Promise<Company> {
    const comp = await this.prisma.company.findUnique({ where: { ruc } });
    if (!comp) {
      throw new NotFoundException(`Empresa con RUC ${ruc} no encontrada.`);
    }
    return comp;
  }

  /**
   * Obtiene y valida una empresa a partir de su API Key.
   */
  public async getCompanyByApiKey(apiKey: string): Promise<Company> {
    if (!apiKey) {
      throw new BadRequestException('API Key no proporcionada en la cabecera x-api-key.');
    }
    const comp = await this.prisma.company.findUnique({
      where: { api_key: apiKey },
      include: { series_list: true },
    });
    if (!comp) {
      throw new NotFoundException('API Key no válida o empresa no encontrada en CCOFACT.');
    }
    if (!comp.is_active) {
      throw new BadRequestException('La empresa emisora asociada a este API Key se encuentra suspendida.');
    }
    return comp;
  }

  /**
   * Registra una nueva empresa en la plataforma CCOFACT PRO.
   */
  public async createCompany(data: any): Promise<Company> {
    if (!data.ruc) {
      throw new BadRequestException('El número de RUC es obligatorio para registrar una empresa.');
    }

    if (!this.validarRucModulo11(data.ruc)) {
      throw new BadRequestException(`El RUC emisor ${data.ruc} no cumple con el algoritmo Módulo 11 de SUNAT.`);
    }

    const exists = await this.prisma.company.findUnique({ where: { ruc: data.ruc } });
    if (exists) {
      throw new BadRequestException(`La empresa con RUC ${data.ruc} ya se encuentra registrada en CCOFACT.`);
    }

    const envMode = data.env_mode || EnvMode.BETA;
    const prefix = envMode === EnvMode.PRODUCCION ? 'fact_live_' : 'fact_test_';
    const randomHex = crypto.randomBytes(24).toString('hex');
    const generatedApiKey = `${prefix}${randomHex}`;

    let certificateExpiresAt: Date | null = null;
    let certificateSubject: string | null = null;
    let certificateIssuer: string | null = null;
    let certificateUrl: string | null = data.certificate_url || null;
    let certificateFilename: string | null = data.certificate_filename || null;

    if (data.certificate_pfx_base64) {
      try {
        const buffer = Buffer.from(data.certificate_pfx_base64, 'base64');
        const certMeta = this.certificateParser.parsePfx(data.certificate_pfx_base64, data.certificate_password || '');
        const filename = certificateFilename || `${data.ruc}-certificado.pfx`;
        const uploadResult = await this.cloudStorage.uploadCertificate(data.ruc, filename, buffer);

        certificateUrl = uploadResult.url;
        certificateExpiresAt = certMeta.validTo;
        certificateSubject = certMeta.subject;
        certificateIssuer = certMeta.issuer;
      } catch (err: any) {
        this.logger.warn(`Advertencia al procesar certificado inicial: ${err.message}`);
      }
    }

    const savedCompany = await this.prisma.company.create({
      data: {
        ruc: data.ruc,
        razon_social: data.razon_social || data.ruc,
        nombre_comercial: data.nombre_comercial || null,
        direccion: data.direccion || 'LIMA, PERU',
        ubigeo: data.ubigeo || '150101',
        departamento: data.departamento || 'LIMA',
        provincia: data.provincia || 'LIMA',
        distrito: data.distrito || 'LIMA',
        urbanizacion: data.urbanizacion || '-',
        email: data.email || null,
        telefono: data.telefono || null,
        sol_user: data.sol_user || 'MODDATOS',
        sol_pass: data.sol_pass || 'moddatos',
        certificate_pfx_base64: data.certificate_pfx_base64 || null,
        certificate_password: data.certificate_password || null,
        certificate_filename: certificateFilename,
        certificate_url: certificateUrl,
        certificate_expires_at: certificateExpiresAt,
        certificate_subject: certificateSubject,
        certificate_issuer: certificateIssuer,
        env_mode: envMode,
        api_key: generatedApiKey,
        webhook_url: data.webhook_url || null,
        is_active: true,
      },
    });

    this.logger.log(`[CCOFACT Multi-tenant] Empresa registrada: ${savedCompany.razon_social} (RUC: ${savedCompany.ruc}) - Entorno: ${savedCompany.env_mode}`);

    try {
      await this.seriesService.createOrUpdateSeries(savedCompany.id, '01', 'F001', 0);
      await this.seriesService.createOrUpdateSeries(savedCompany.id, '03', 'B001', 0);
      await this.seriesService.createOrUpdateSeries(savedCompany.id, '07', 'FC01', 0);
      await this.seriesService.createOrUpdateSeries(savedCompany.id, '07', 'BC01', 0);
      await this.seriesService.createOrUpdateSeries(savedCompany.id, '08', 'FD01', 0);
      await this.seriesService.createOrUpdateSeries(savedCompany.id, '08', 'BD01', 0);
      this.logger.log(`[CCOFACT Multi-tenant] Series predeterminadas inicializadas para RUC ${savedCompany.ruc}`);
    } catch (err: any) {
      this.logger.warn(`No se pudieron auto-crear las series predeterminadas: ${err.message}`);
    }

    return savedCompany;
  }

  /**
   * Actualiza la información fiscal, certificado digital o credenciales SOL de una empresa.
   */
  public async updateCompany(id: string, updateData: any): Promise<Company> {
    const company = await this.getCompanyById(id);

    if (updateData.ruc && updateData.ruc !== company.ruc) {
      if (!this.validarRucModulo11(updateData.ruc)) {
        throw new BadRequestException(`El nuevo RUC ${updateData.ruc} es inválido ante SUNAT.`);
      }
      const existingRuc = await this.prisma.company.findUnique({ where: { ruc: updateData.ruc } });
      if (existingRuc && existingRuc.id !== id) {
        throw new BadRequestException(`El RUC ${updateData.ruc} ya pertenece a otra empresa registrada.`);
      }
    }

    const dataToSave: any = { ...updateData };

    if (updateData.certificate_pfx_base64) {
      try {
        const buffer = Buffer.from(updateData.certificate_pfx_base64, 'base64');
        if (buffer.length < 50) {
          throw new Error('Certificado PFX demasiado pequeño o corrupto');
        }

        const certPassword =
          updateData.certificate_password !== undefined
            ? updateData.certificate_password
            : company.certificate_password;

        const certMeta = this.certificateParser.parsePfx(
          updateData.certificate_pfx_base64,
          certPassword || '',
        );

        dataToSave.certificate_expires_at = certMeta.validTo;
        dataToSave.certificate_subject = certMeta.subject;
        dataToSave.certificate_issuer = certMeta.issuer;

        const filename =
          updateData.certificate_filename ||
          company.certificate_filename ||
          `${company.ruc}-certificado.pfx`;

        const uploadResult = await this.cloudStorage.uploadCertificate(
          company.ruc,
          filename,
          buffer,
        );

        dataToSave.certificate_filename = filename;
        dataToSave.certificate_url = uploadResult.url;
        this.logger.log(`[CERTIFICADO CLOUD] Certificado guardado en DigitalOcean Spaces (${uploadResult.url}) para RUC ${company.ruc}`);
      } catch (err: any) {
        throw new BadRequestException(`Fallo en validación de Certificado Digital .PFX: ${err.message}`);
      }
    }

    const targetEnv = updateData.env_mode || company.env_mode;
    if (updateData.env_mode) {
      const requiredPrefix = targetEnv === EnvMode.PRODUCCION ? 'fact_live_' : 'fact_test_';
      if (!company.api_key || !company.api_key.startsWith(requiredPrefix)) {
        const randomHex = crypto.randomBytes(24).toString('hex');
        dataToSave.api_key = `${requiredPrefix}${randomHex}`;
        this.logger.log(`[CCOFACT Entorno] Empresa ${company.ruc} actualizada a ${targetEnv}. Nueva API Key asignada: ${dataToSave.api_key}`);
      }
    }

    // Limpieza de campos que no pertenecen al modelo
    delete dataToSave.branches;
    delete dataToSave.series_list;
    delete dataToSave.documents;
    delete dataToSave.jobs;
    delete dataToSave.users;

    return this.prisma.company.update({
      where: { id },
      data: dataToSave,
    });
  }

  /**
   * Conmuta instantáneamente el entorno de una empresa entre BETA y PRODUCCION.
   */
  public async switchEnvironment(id: string, targetEnv: EnvMode, solUser?: string, solPass?: string): Promise<Company> {
    const company = await this.getCompanyById(id);

    const prefix = targetEnv === EnvMode.PRODUCCION ? 'fact_live_' : 'fact_test_';
    const randomHex = crypto.randomBytes(24).toString('hex');
    const newApiKey = `${prefix}${randomHex}`;

    const dataToUpdate: any = {
      env_mode: targetEnv,
      api_key: newApiKey,
    };
    if (solUser && solUser.trim()) dataToUpdate.sol_user = solUser.trim();
    if (solPass && solPass.trim()) dataToUpdate.sol_pass = solPass.trim();

    const saved = await this.prisma.company.update({
      where: { id },
      data: dataToUpdate,
    });
    this.logger.log(`[CCOFACT Entorno] Empresa ${company.razon_social} (${company.ruc}) conmutada a ${targetEnv}. API Key Oficial: ${newApiKey}`);
    return saved;
  }

  /**
   * Regenera la API Key de una empresa por motivos de seguridad o rotación de credenciales.
   */
  public async regenerateApiKey(id: string): Promise<Company> {
    const company = await this.getCompanyById(id);
    const prefix = company.env_mode === EnvMode.PRODUCCION ? 'fact_live_' : 'fact_test_';
    const randomHex = crypto.randomBytes(24).toString('hex');
    const newApiKey = `${prefix}${randomHex}`;

    const updated = await this.prisma.company.update({
      where: { id },
      data: { api_key: newApiKey },
    });
    this.logger.log(`[CCOFACT Seguridad] API Key rotada exitosamente para empresa ${company.razon_social} (RUC: ${company.ruc})`);
    return updated;
  }

  /**
   * Auditoría y Validación de Autenticidad Fiscal Pro ante SUNAT.
   */
  public async verifyFiscalHealth(companyId: string) {
    const company = await this.getCompanyById(companyId);

    const isRucValid = this.validarRucModulo11(company.ruc);
    const hasSolCreds = Boolean(company.sol_user && company.sol_pass && company.sol_user !== 'MODDATOS');
    const hasCertificate = Boolean(company.certificate_pfx_base64 || company.certificate_url);

    let certStatus = 'NO_CONFIGURADO';
    let daysToExpiry: number | null = null;

    if (company.certificate_expires_at) {
      const now = new Date();
      const expiry = new Date(company.certificate_expires_at);
      const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      daysToExpiry = diffDays;
      certStatus = diffDays > 30 ? 'VIGENTE' : diffDays > 0 ? 'POR_VENCER' : 'EXPIRADO';
    }

    return {
      ruc: company.ruc,
      razon_social: company.razon_social,
      env_mode: company.env_mode,
      is_ruc_valid: isRucValid,
      has_sol_credentials: hasSolCreds,
      certificate: {
        status: certStatus,
        has_certificate: hasCertificate,
        days_to_expiry: daysToExpiry,
        expires_at: company.certificate_expires_at,
        issuer: company.certificate_issuer,
      },
      ready_for_production: isRucValid && hasSolCreds && hasCertificate && certStatus === 'VIGENTE',
    };
  }

  /**
   * Obtiene la configuración de integración externa para Control Finanzas / ERP.
   */
  public async getIntegrationConfig(companyId: string) {
    const company = await this.getCompanyById(companyId);
    return {
      CCOFACT_API_URL: process.env.APP_URL || `http://localhost:${process.env.PORT || 4001}/api/v1`,
      CCOFACT_API_KEY: company.api_key,
      CCOFACT_ENV: company.env_mode,
      EMISOR_RUC: company.ruc,
      EMISOR_RAZON_SOCIAL: company.razon_social,
    };
  }

  /**
   * Obtiene el estado del certificado digital.
   */
  public async getCertificateStatus(companyId: string) {
    const company = await this.getCompanyById(companyId);
    return {
      hasCertificate: Boolean(company.certificate_pfx_base64 || company.certificate_url),
      filename: company.certificate_filename,
      url: company.certificate_url,
      expiresAt: company.certificate_expires_at,
      subject: company.certificate_subject,
      issuer: company.certificate_issuer,
    };
  }

  /**
   * Lista todas las empresas administradas en la plataforma CCOFACT.
   */
  public async listAllCompanies(): Promise<Company[]> {
    return this.prisma.company.findMany({
      orderBy: { created_at: 'desc' },
    });
  }

  public async listCompanies(): Promise<Company[]> {
    return this.listAllCompanies();
  }

  /**
   * Elimina una empresa y toda su información asociada limpiamente con Prisma.
   */
  public async deleteCompany(id: string): Promise<{ success: boolean; message: string }> {
    const comp = await this.prisma.company.findUnique({ where: { id } });
    if (!comp) {
      throw new NotFoundException(`Empresa con ID ${id} no encontrada.`);
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Eliminar items de documentos
      await tx.documentItem.deleteMany({
        where: { document: { company_id: id } },
      });
      // 2. Eliminar documentos
      await tx.document.deleteMany({
        where: { company_id: id },
      });
      // 3. Eliminar invoice_jobs
      await tx.invoiceJob.deleteMany({
        where: { company_id: id },
      });
      // 4. Eliminar series
      await tx.series.deleteMany({
        where: { company_id: id },
      });
      // 5. Eliminar branches
      await tx.branch.deleteMany({
        where: { company_id: id },
      });
      // 6. Eliminar empresa
      await tx.company.delete({
        where: { id },
      });
    });

    this.logger.log(`Empresa con ID ${id} (${comp.razon_social}) y sus registros asociados fueron eliminados.`);
    return { success: true, message: `Empresa ${comp.razon_social} eliminada exitosamente.` };
  }

  private validarRucModulo11(ruc: string): boolean {
    if (!ruc || !/^[0-9]{11}$/.test(ruc)) {
      return false;
    }
    const factores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    for (let i = 0; i < 10; i++) {
      suma += parseInt(ruc.charAt(i), 10) * factores[i];
    }
    const residuo = suma % 11;
    let digitoVerificador = 11 - residuo;
    if (digitoVerificador === 10) digitoVerificador = 0;
    if (digitoVerificador === 11) digitoVerificador = 1;
    const ultimoDigito = parseInt(ruc.charAt(10), 10);
    return digitoVerificador === ultimoDigito;
  }
}
