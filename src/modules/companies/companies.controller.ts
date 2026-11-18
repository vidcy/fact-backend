import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import type { Company } from '@prisma/client';

@ApiTags('Empresas y Multi-Tenant')
@Controller('api/v1/companies')
export class CompaniesController {
  constructor(private companiesService: CompaniesService) {}

  @Get('current')
  @ApiSecurity('api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Obtener datos de la empresa autenticada con su API Key' })
  async getCurrent(@CurrentCompany() company: Company) {
    return this.companiesService.getCompanyById(company.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todas las empresas registradas en la plataforma' })
  async listAll() {
    return this.companiesService.listAllCompanies();
  }

  @Post()
  @ApiOperation({ summary: 'Registrar nueva empresa en la plataforma con generación de API Key' })
  async create(@Body() body: any) {
    return this.companiesService.createCompany(body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar configuración de empresa (SOL, Certificado, Webhook)' })
  async update(@Param('id') id: string, @Body() body: any) {
    return this.companiesService.updateCompany(id, body);
  }

  @Get(':id/integration-config')
  @ApiOperation({ summary: 'Obtener variables y credenciales formateadas para integración con sistemas externos (Control Finanzas / ERP)' })
  async getIntegrationConfig(@Param('id') id: string) {
    return this.companiesService.getIntegrationConfig(id);
  }

  @Get(':id/certificate')
  @ApiOperation({ summary: 'Obtener estado del certificado digital X.509, metadatos y URL en DigitalOcean Spaces' })
  async getCertificateStatus(@Param('id') id: string) {
    return this.companiesService.getCertificateStatus(id);
  }

  @Post(':id/verify-fiscal')
  @ApiOperation({ summary: 'Ejecutar auditoría y verificación pro de autenticidad fiscal SUNAT para un negocio' })
  async verifyFiscal(@Param('id') id: string) {
    return this.companiesService.verifyFiscalHealth(id);
  }

  @Post(':id/switch-env')
  @ApiOperation({ summary: 'Conmutar entorno entre BETA y PRODUCCION con actualización inmediata de API Key (fact_live_ o fact_test_)' })
  async switchEnv(
    @Param('id') id: string,
    @Body() body: { env_mode: any; sol_user?: string; sol_pass?: string },
  ) {
    return this.companiesService.switchEnvironment(id, body.env_mode, body.sol_user, body.sol_pass);
  }

  @Post(':id/regenerate-key')
  @ApiOperation({ summary: 'Regenerar API Key de una empresa' })
  async regenKey(@Param('id') id: string) {
    const key = await this.companiesService.regenerateApiKey(id);
    return { api_key: key, message: 'Nueva API Key generada exitosamente' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una empresa y todos sus registros asociados' })
  async deleteCompany(@Param('id') id: string) {
    return this.companiesService.deleteCompany(id);
  }
}
