import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';

@ApiTags('Monitoreo de Colas SUNAT')
@Controller('api/v1/queue')
export class QueueController {
  constructor(private queueService: QueueService) {}

  @Get('status')
  @ApiOperation({ summary: 'Obtener estado y métricas de la cola de envíos y reintentos' })
  async getStatus() {
    return this.queueService.getQueueStats();
  }

  @Post('trigger')
  @ApiOperation({ summary: 'Disparar procesamiento inmediato del worker de colas' })
  async trigger() {
    await this.queueService.processNextJobs();
    return { message: 'Worker ejecutado exitosamente' };
  }
}
