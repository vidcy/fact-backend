import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceJob } from '../../entities/invoice-job.entity';
import { Document } from '../../entities/document.entity';
import { Company } from '../../entities/company.entity';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { SunatCoreModule } from '../sunat-core/sunat-core.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceJob, Document, Company]),
    SunatCoreModule,
  ],
  providers: [QueueService],
  controllers: [QueueController],
  exports: [QueueService],
})
export class QueueModule {}
