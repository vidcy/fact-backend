import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { SeriesService } from './series.service';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { Company } from '../../entities/company.entity';

@ApiTags('Series y Correlativos')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('api/v1/series')
export class SeriesController {
  constructor(private seriesService: SeriesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas las series configuradas para la empresa' })
  async list(@CurrentCompany() company: Company) {
    return this.seriesService.getSeriesByCompany(company.id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear o ajustar serie y correlativo' })
  async create(
    @CurrentCompany() company: Company,
    @Body() body: { document_type: string; series: string; initial_number?: number },
  ) {
    return this.seriesService.createOrUpdateSeries(
      company.id,
      body.document_type,
      body.series,
      body.initial_number || 0,
    );
  }
}
