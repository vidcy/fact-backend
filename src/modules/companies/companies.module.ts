import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../entities/company.entity';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { SeriesModule } from '../series/series.module';
import { CloudStorageService } from './services/cloud-storage.service';
import { CertificateParserService } from './services/certificate-parser.service';

@Module({
  imports: [TypeOrmModule.forFeature([Company]), SeriesModule],
  providers: [CompaniesService, CloudStorageService, CertificateParserService],
  controllers: [CompaniesController],
  exports: [CompaniesService, CloudStorageService, CertificateParserService],
})
export class CompaniesModule {}
