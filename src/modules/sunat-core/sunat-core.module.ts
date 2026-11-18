import { Module } from '@nestjs/common';
import { NumberToWordsService } from './services/number-to-words.service';
import { UblBuilderService } from './services/ubl-builder.service';
import { XmlSignerService } from './services/xml-signer.service';
import { QrService } from './services/qr.service';
import { SunatSoapService } from './services/sunat-soap.service';
import { PdfBuilderService } from './services/pdf-builder.service';
import { SunatValidatorService } from './services/sunat-validator.service';
import { ConsultasService } from './services/consultas.service';

@Module({
  providers: [
    NumberToWordsService,
    UblBuilderService,
    XmlSignerService,
    QrService,
    SunatSoapService,
    PdfBuilderService,
    SunatValidatorService,
    ConsultasService,
  ],
  exports: [
    NumberToWordsService,
    UblBuilderService,
    XmlSignerService,
    QrService,
    SunatSoapService,
    PdfBuilderService,
    SunatValidatorService,
    ConsultasService,
  ],
})
export class SunatCoreModule {}
