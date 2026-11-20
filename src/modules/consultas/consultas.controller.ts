import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConsultasService } from './consultas.service';

@ApiTags('Consultas RUC y DNI SUNAT')
@Controller(['api/v1/consultas', 'consultas'])
export class ConsultasController {
  constructor(private readonly consultasService: ConsultasService) {}

  @Get('ruc/:ruc')
  @ApiOperation({ summary: 'Consultar datos oficiales de RUC ante SUNAT y resolver dirección y ubigeo' })
  async getRuc(@Param('ruc') ruc: string) {
    return this.consultasService.consultarRuc(ruc);
  }

  @Get('dni/:dni')
  @ApiOperation({ summary: 'Consultar datos oficiales de DNI ante RENIEC' })
  async getDni(@Param('dni') dni: string) {
    return this.consultasService.consultarDni(dni);
  }
}
