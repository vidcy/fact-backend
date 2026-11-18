import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../../entities/document.entity';
import { DocumentItem } from '../../entities/document-item.entity';
import { InvoiceJob } from '../../entities/invoice-job.entity';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { SeriesModule } from '../series/series.module';
import { SunatCoreModule } from '../sunat-core/sunat-core.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, DocumentItem, InvoiceJob]),
    SeriesModule,
    SunatCoreModule,
  ],
  providers: [DocumentsService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
