import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { SunatCoreModule } from '../sunat-core/sunat-core.module';

@Module({
  imports: [SunatCoreModule],
  providers: [QueueService],
  controllers: [QueueController],
  exports: [QueueService],
})
export class QueueModule {}
