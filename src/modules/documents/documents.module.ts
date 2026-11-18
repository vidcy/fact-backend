import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { SeriesModule } from '../series/series.module';
import { SunatCoreModule } from '../sunat-core/sunat-core.module';

@Module({
  imports: [SeriesModule, SunatCoreModule],
  providers: [DocumentsService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
