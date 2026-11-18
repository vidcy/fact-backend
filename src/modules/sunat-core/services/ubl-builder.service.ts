import { Injectable } from '@nestjs/common';
import { Company, Document, DocumentItem } from '@prisma/client';
import { NumberToWordsService } from './number-to-words.service';

type DocumentWithItems = Document & { items?: DocumentItem[] };

/**
 * ============================================================================
 * CCOFACT PRO - CONSTRUCTOR DE DOCUMENTOS XML UBL 2.1 (CORPORACIÓN CCOPLEX)
 * ============================================================================
 * Genera el documento XML conforme a las especificaciones técnicas oficiales
 * de la Superintendencia Nacional de Aduanas y de Administración Tributaria (SUNAT):
 * - Estándar: OASIS Universal Business Language (UBL) 2.1
 * - Documentos soportados: Factura (01), Boleta (03), Nota de Crédito (07), Nota de Débito (08)
 * - Codificación: ISO-8859-1 (exigida por SUNAT para caracteres especiales y tildes)
 * - Estructura de extensiones: UBLExtensions requerida para la firma digital XMLDSig
 */
@Injectable()
export class UblBuilderService {
  constructor(
    // Servicio de conversión de importes monetarios a texto en español (Leyenda 1000)
    private numberToWords: NumberToWordsService,
  ) {}

  /**
   * Construye el documento XML completo en estándar UBL 2.1 listo para ser firmado digitalmente.
   * 
   * @param document Entidad del comprobante con montos, fechas, cliente y líneas de detalle
   * @param company Entidad de la empresa emisora con RUC, razón social, ubigeo y dirección
   * @returns Cadena de texto con el XML UBL 2.1 estructurado y validado
   */
  public buildInvoiceXml(document: DocumentWithItems, company: Company): string {
    // 1. Identificar el tipo de documento para determinar el nodo raíz y schema XML
    const isCreditNote = document.document_type === '07';
    const isDebitNote = document.document_type === '08';

    // 2. Generar texto en letras del importe total (Catálogo 52 - Código 1000)
    const legend1000 = this.numberToWords.convert(Number(document.total_amount), document.currency);

    // 3. Etiqueta raíz del XML según el estándar OASIS
    const rootTag = isCreditNote
      ? 'CreditNote'
      : isDebitNote
      ? 'DebitNote'
      : 'Invoice';

    // 4. Espacio de nombres oficial de SUNAT para el tipo de documento
    const rootNamespace = isCreditNote
      ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
      : isDebitNote
      ? 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2'
      : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';

    // 5. Iniciar la declaración XML con codificación ISO-8859-1 y definición de namespaces
    let xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<${rootTag} xmlns="${rootNamespace}"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:qdt="urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2"
  xmlns:udt="urn:un:unece:uncefact:data:specification:UnqualifiedDataTypesSchemaModule:2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${document.full_number}</cbc:ID>
  <cbc:IssueDate>${document.issue_date}</cbc:IssueDate>
  <cbc:IssueTime>${document.issue_time}</cbc:IssueTime>`;

    // 6. Si es Factura o Boleta, incluir tipo de comprobante y leyenda monetaria
    if (!isCreditNote && !isDebitNote) {
      const meta = (document.metadata as any) || {};
      const metaObs = typeof meta.observaciones === 'string' ? meta.observaciones : '';
      const hasAmazonia =
        Number(document.total_exonerada) > 0 ||
        (metaObs &&
          (metaObs.includes('Amazonía') ||
            metaObs.includes('AMAZONÍA') ||
            metaObs.includes('27037'))) ||
        (company.departamento &&
          company.departamento.toLowerCase().includes('madre de dios'));

      xml += `
  <cbc:InvoiceTypeCode listAgencyName="PE:SUNAT" listID="${document.operation_type || '0101'}" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">${document.document_type}</cbc:InvoiceTypeCode>
  <cbc:Note languageLocaleID="1000"><![CDATA[${legend1000}]]></cbc:Note>`;

      if (hasAmazonia) {
        xml += `
  <cbc:Note languageLocaleID="2001"><![CDATA[BIENES TRANSFERIDOS EN LA AMAZONÍA PARA SER CONSUMIDOS EN LA MISMA - LEY N° 27037]]></cbc:Note>`;
      }

      if (metaObs && !metaObs.includes('27037')) {
        xml += `
  <cbc:Note languageLocaleID="9999"><![CDATA[${metaObs}]]></cbc:Note>`;
      }

      xml += `
  <cbc:DocumentCurrencyCode listAgencyName="United Nations Economic Commission for Europe" listID="ISO 4217 Alpha" listName="Currency">${document.currency}</cbc:DocumentCurrencyCode>`;
    } else {
      // Notas de Crédito / Débito
      xml += `
  <cbc:DocumentCurrencyCode listAgencyName="United Nations Economic Commission for Europe" listID="ISO 4217 Alpha" listName="Currency">${document.currency}</cbc:DocumentCurrencyCode>`;

      // Referencia obligatoria al comprobante que se modifica (Catálogo 09 para NC / Catálogo 10 para ND)
      if (isCreditNote || isDebitNote) {
        xml += `
  <cac:DiscrepancyResponse>
    <cbc:ReferenceID>${document.ref_series || 'F001'}-${String(document.ref_number || 1).padStart(8, '0')}</cbc:ReferenceID>
    <cbc:ResponseCode>${document.ref_reason_code || (isCreditNote ? '01' : '02')}</cbc:ResponseCode>
    <cbc:Description><![CDATA[${document.ref_reason_desc || (isCreditNote ? 'ANULACION DE LA OPERACION' : 'AUMENTO EN EL VALOR')}]]></cbc:Description>
  </cac:DiscrepancyResponse>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${document.ref_series || 'F001'}-${String(document.ref_number || 1).padStart(8, '0')}</cbc:ID>
      <cbc:DocumentTypeCode>${document.ref_document_type || '01'}</cbc:DocumentTypeCode>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`;
      }
    }

    // 7. Bloque del Emisor (Datos fiscales de la empresa emisora)
    xml += `
  <cac:Signature>
    <cbc:ID>${company.ruc}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID>${company.ruc}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name><![CDATA[${company.razon_social}]]></cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#SIGN-CCOFACT</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeAgencyName="PE:SUNAT" schemeID="6" schemeName="Documento de Identidad" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${company.ruc}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name><![CDATA[${company.nombre_comercial || company.razon_social}]]></cbc:Name>
      </cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${company.razon_social}]]></cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${company.ubigeo}</cbc:ID>
          <cbc:AddressTypeCode listAgencyName="PE:SUNAT" listName="Establecimientos anexos">0000</cbc:AddressTypeCode>
          <cac:AddressLine>
            <cbc:Line><![CDATA[${company.direccion}]]></cbc:Line>
          </cac:AddressLine>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>`;

    // 8. Bloque del Cliente / Adquiriente
    xml += `
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeAgencyName="PE:SUNAT" schemeID="${document.client_doc_type}" schemeName="Documento de Identidad" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${document.client_doc_number}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${document.client_name}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`;

    // 9. Bloque de Forma de Pago (Contado / Crédito)
    if (!isCreditNote && !isDebitNote) {
      xml += `
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>${document.payment_type || 'Contado'}</cbc:PaymentMeansID>
    <cbc:Amount currencyID="${document.currency}">${Number(document.total_amount).toFixed(2)}</cbc:Amount>
  </cac:PaymentTerms>`;
    }

    // 10. Bloque de Totales de Impuestos (IGV, Exonerado, Inafecto)
    const totalIgv = Number(document.total_igv || 0).toFixed(2);
    const totalGravada = Number(document.total_gravada || 0).toFixed(2);
    const totalExonerada = Number(document.total_exonerada || 0).toFixed(2);
    const totalInafecta = Number(document.total_inafecta || 0).toFixed(2);

    let taxSubtotalsXml = '';

    // Gravada (si hay o si todo es 0)
    if (Number(totalGravada) > 0 || (Number(totalExonerada) === 0 && Number(totalInafecta) === 0)) {
      taxSubtotalsXml += `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${document.currency}">${totalGravada}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${document.currency}">${totalIgv}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID schemeAgencyName="PE:SUNAT" schemeID="UN/ECE 5153" schemeName="Codigo de tributos">1000</cbc:ID>
          <cbc:Name>IGV</cbc:Name>
          <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
    }

    // Exonerada (Amazonía / Apéndice I)
    if (Number(totalExonerada) > 0) {
      taxSubtotalsXml += `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${document.currency}">${totalExonerada}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${document.currency}">0.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID schemeAgencyName="PE:SUNAT" schemeID="UN/ECE 5153" schemeName="Codigo de tributos">9997</cbc:ID>
          <cbc:Name>EXONERADO</cbc:Name>
          <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
    }

    // Inafecta
    if (Number(totalInafecta) > 0) {
      taxSubtotalsXml += `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${document.currency}">${totalInafecta}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${document.currency}">0.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID schemeAgencyName="PE:SUNAT" schemeID="UN/ECE 5153" schemeName="Codigo de tributos">9998</cbc:ID>
          <cbc:Name>INAFECTO</cbc:Name>
          <cbc:TaxTypeCode>FRE</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
    }

    xml += `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${document.currency}">${totalIgv}</cbc:TaxAmount>${taxSubtotalsXml}
  </cac:TaxTotal>`;

    // 11. Bloque de Totales Monetarios Legales
    if (!isCreditNote && !isDebitNote) {
      xml += `
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${document.currency}">${Number(document.subtotal).toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${document.currency}">${Number(document.total_amount).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${document.currency}">${Number(document.total_amount).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;
    } else {
      xml += `
  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="${document.currency}">${Number(document.total_amount).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;
    }

    // 12. Líneas de Detalle del Comprobante
    const itemTag = isCreditNote ? 'CreditNoteLine' : isDebitNote ? 'DebitNoteLine' : 'InvoiceLine';

    (document.items || []).forEach((item, index) => {
      const lineTotal = Number(item.total).toFixed(2);
      const lineSubtotal = Number(item.subtotal).toFixed(2);
      const unitVal = Number(item.unit_value).toFixed(4);
      const unitPrice = Number(item.unit_price).toFixed(4);
      const lineIgv = Number(item.igv_amount).toFixed(2);

      const affectation = item.igv_affectation_type || '10';
      const isExonerated = affectation === '20';
      const isInafecto = affectation === '30';
      const isExportacion = affectation === '40';

      let schemeId = '1000';
      let schemeName = 'IGV';
      let taxTypeCode = 'VAT';
      let taxPercent = '18.00';

      if (isExonerated) {
        schemeId = '9997';
        schemeName = 'EXONERADO';
        taxTypeCode = 'VAT';
        taxPercent = '0.00';
      } else if (isInafecto) {
        schemeId = '9998';
        schemeName = 'INAFECTO';
        taxTypeCode = 'FRE';
        taxPercent = '0.00';
      } else if (isExportacion) {
        schemeId = '9995';
        schemeName = 'EXP';
        taxTypeCode = 'FRE';
        taxPercent = '0.00';
      } else if (affectation === '10_MYPE') {
        schemeId = '1000';
        schemeName = 'IGV';
        taxTypeCode = 'VAT';
        taxPercent = '10.00';
      }

      xml += `
  <cac:${itemTag}>
    <cbc:ID>${item.item_order || index + 1}</cbc:ID>
    <cbc:${isCreditNote ? 'CreditedQuantity' : isDebitNote ? 'DebitedQuantity' : 'InvoicedQuantity'} unitCode="${item.unit_measure || 'NIU'}">${Number(item.quantity).toFixed(2)}</cbc:${isCreditNote ? 'CreditedQuantity' : isDebitNote ? 'DebitedQuantity' : 'InvoicedQuantity'}>
    <cbc:LineExtensionAmount currencyID="${document.currency}">${lineSubtotal}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount currencyID="${document.currency}">${unitPrice}</cbc:PriceAmount>
        <cbc:PriceTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Precio" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo16">01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${document.currency}">${lineIgv}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${document.currency}">${lineSubtotal}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${document.currency}">${lineIgv}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${taxPercent}</cbc:Percent>
          <cbc:TaxExemptionReasonCode listAgencyName="PE:SUNAT" listName="Afectacion del IGV" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07">${affectation === '10_MYPE' ? '10' : affectation}</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme>
            <cbc:ID schemeAgencyName="PE:SUNAT" schemeID="UN/ECE 5153" schemeName="Codigo de tributos">${schemeId}</cbc:ID>
            <cbc:Name>${schemeName}</cbc:Name>
            <cbc:TaxTypeCode>${taxTypeCode}</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description><![CDATA[${item.description}]]></cbc:Description>
      <cac:SellersItemIdentification>
        <cbc:ID>${item.code || 'PRD'}</cbc:ID>
      </cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${document.currency}">${unitVal}</cbc:PriceAmount>
    </cac:Price>
  </cac:${itemTag}>`;
    });

    // 13. Cerrar etiqueta raíz del XML
    xml += `\n</${rootTag}>`;

    return xml;
  }
}
