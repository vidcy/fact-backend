import { Injectable } from '@nestjs/common';
import { Document, Company, DocumentItem } from '@prisma/client';
import { NumberToWordsService } from './number-to-words.service';

type DocumentWithItems = Document & { items?: DocumentItem[] };

@Injectable()
export class PdfBuilderService {
  constructor(private numberToWords: NumberToWordsService) {}

  public generateHtml(
    document: DocumentWithItems,
    company: Company,
    qrDataUrl: string,
    format: 'A4' | 'TICKET' = 'A4',
  ): string {
    const docTitle =
      document.document_type === '01'
        ? 'FACTURA ELECTRÓNICA'
        : document.document_type === '03'
        ? 'BOLETA DE VENTA ELECTRÓNICA'
        : document.document_type === '07'
        ? 'NOTA DE CRÉDITO ELECTRÓNICA'
        : document.document_type === '08'
        ? 'NOTA DE DÉBITO ELECTRÓNICA'
        : 'GUÍA DE REMISIÓN ELECTRÓNICA - REMITENTE';

    const words = this.numberToWords.convert(Number(document.total_amount), document.currency);

    if (format === 'TICKET') {
      return this.renderTicket(document, company, qrDataUrl, docTitle, words);
    }

    return this.renderA4(document, company, qrDataUrl, docTitle, words);
  }

  public buildA4Html(document: DocumentWithItems, company: Company, qrDataUrl: string): string {
    return this.generateHtml(document, company, qrDataUrl, 'A4');
  }

  public buildTicketHtml(document: DocumentWithItems, company: Company, qrDataUrl: string): string {
    return this.generateHtml(document, company, qrDataUrl, 'TICKET');
  }

  private renderA4(
    doc: DocumentWithItems,
    company: Company,
    qrDataUrl: string,
    docTitle: string,
    words: string,
  ): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${doc.full_number} - ${company.razon_social}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; font-size: 12px; color: #1e293b; margin: 0; padding: 0; background: #fff; }
    .invoice-container { max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .company-logo-area { display: flex; gap: 15px; align-items: center; max-width: 60%; }
    .company-avatar { width: 56px; height: 56px; border-radius: 12px; background: #4f46e5; color: #fff; font-size: 24px; font-weight: bold; display: flex; align-items: center; justify-content: center; }
    .company-details h1 { font-size: 17px; font-weight: 800; color: #0f172a; margin: 0 0 4px; line-height: 1.2; text-transform: uppercase; }
    .company-sub { font-size: 11px; color: #475569; line-height: 1.45; }
    .doc-box { border: 2.5px solid #0f172a; border-radius: 10px; padding: 14px 20px; text-align: center; width: 280px; background: #f8fafc; }
    .doc-box .ruc { font-size: 14px; font-weight: bold; color: #0f172a; letter-spacing: 0.5px; }
    .doc-box .title { font-size: 15px; font-weight: 800; color: #4338ca; margin: 6px 0; text-transform: uppercase; }
    .doc-box .number { font-size: 16px; font-weight: 900; color: #0f172a; font-family: monospace; }
    
    .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 4px; margin: 15px 0 10px; letter-spacing: 0.5px; }
    .client-grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 18px; }
    .field-row { display: flex; margin-bottom: 4px; }
    .field-label { width: 130px; font-weight: 700; color: #64748b; font-size: 11px; }
    .field-value { flex: 1; color: #0f172a; font-size: 11px; font-weight: 600; }
    
    table.items-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    table.items-table th { background: #0f172a; color: #fff; font-size: 11px; font-weight: 700; padding: 9px 12px; text-transform: uppercase; letter-spacing: 0.3px; }
    table.items-table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; font-size: 11px; color: #334155; }
    table.items-table tr:nth-child(even) { background: #f8fafc; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    
    .words-box { background: #eef2ff; border-left: 4px solid #4f46e5; padding: 8px 14px; font-size: 11px; font-weight: 700; color: #3730a3; margin-bottom: 18px; border-radius: 0 6px 6px 0; }
    
    .footer-area { display: grid; grid-template-columns: 1fr 280px; gap: 20px; align-items: start; }
    .qr-info-block { display: flex; gap: 14px; align-items: center; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: #f8fafc; }
    .qr-img { width: 105px; height: 105px; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 3px; }
    .audit-meta { font-size: 10px; color: #64748b; line-height: 1.45; word-break: break-all; }
    .badge-accepted { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
    
    .totals-area { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #fff; }
    .total-row { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 11px; border-bottom: 1px solid #f1f5f9; }
    .total-row.grand-total { background: #0f172a; color: #fff; font-size: 14px; font-weight: 800; padding: 9px 12px; border-bottom: none; }
    .legal-notice { font-size: 9px; color: #94a3b8; text-align: center; margin-top: 25px; border-top: 1px solid #e2e8f0; padding-top: 10px; }
  </style>
</head>
<body>
  <div class="invoice-container">
    <div class="header">
      <div class="company-logo-area">
        <div class="company-avatar">${company.razon_social.charAt(0)}</div>
        <div class="company-details">
          <h1>${company.razon_social}</h1>
          <div class="company-sub">
            ${company.nombre_comercial ? '<b>' + company.nombre_comercial + '</b><br>' : ''}
            ${company.direccion}<br>
            ${company.distrito} - ${company.provincia} - ${company.departamento} (Ubigeo: ${company.ubigeo})<br>
            Email: ${company.email || 'contacto@empresa.pe'} | Tel: ${company.telefono || '-'}
          </div>
        </div>
      </div>
      <div class="doc-box">
        <div class="ruc">R.U.C. ${company.ruc}</div>
        <div class="title">${docTitle}</div>
        <div class="number">${doc.full_number}</div>
      </div>
    </div>

    <div class="client-grid">
      <div>
        <div class="field-row"><span class="field-label">${doc.document_type === '09' ? 'DESTINATARIO:' : 'SEÑOR(ES):'}</span><span class="field-value">${doc.client_name}</span></div>
        <div class="field-row"><span class="field-label">${doc.client_doc_type === '6' ? 'R.U.C.' : 'DOCUMENTO'}:</span><span class="field-value font-mono">${doc.client_doc_number}</span></div>
        <div class="field-row"><span class="field-label">DIRECCIÓN:</span><span class="field-value">${doc.client_address || '-'}</span></div>
      </div>
      <div>
        <div class="field-row"><span class="field-label">FECHA EMISIÓN:</span><span class="field-value">${doc.issue_date} ${doc.issue_time}</span></div>
        <div class="field-row"><span class="field-label">MONEDA:</span><span class="field-value">${doc.currency === 'PEN' ? 'SOLES (S/)' : 'DÓLARES ($)'}</span></div>
        <div class="field-row"><span class="field-label">FORMA DE PAGO:</span><span class="field-value">${doc.payment_type}</span></div>
      </div>
    </div>

    ${doc.document_type === '09' ? `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
      <div>
        <div style="font-weight: 800; font-size: 10px; color: #4338ca; text-transform: uppercase; margin-bottom: 6px;">DATOS DEL TRASLADO</div>
        <div class="field-row"><span class="field-label">MOTIVO:</span><span class="field-value">${(doc.metadata as any)?.guia_datos?.motivo_traslado_descripcion || 'VENTA'}</span></div>
        <div class="field-row"><span class="field-label">MODALIDAD:</span><span class="field-value">${(doc.metadata as any)?.guia_datos?.modalidad_traslado === '01' ? 'TRANSPORTE PÚBLICO' : 'TRANSPORTE PRIVADO'}</span></div>
        <div class="field-row"><span class="field-label">INICIO TRASLADO:</span><span class="field-value">${(doc.metadata as any)?.guia_datos?.fecha_inicio_traslado || doc.issue_date}</span></div>
        <div class="field-row"><span class="field-label">PESO TOTAL:</span><span class="field-value font-mono font-bold">${(doc.metadata as any)?.guia_datos?.peso_bruto_total || 1} ${(doc.metadata as any)?.guia_datos?.unidad_peso || 'KGM'}</span></div>
        <div class="field-row"><span class="field-label">N° BULTOS:</span><span class="field-value font-mono font-bold">${(doc.metadata as any)?.guia_datos?.numero_bultos || 1}</span></div>
      </div>
      <div>
        <div style="font-weight: 800; font-size: 10px; color: #4338ca; text-transform: uppercase; margin-bottom: 6px;">PUNTOS DE TRASLADO Y TRANSPORTE</div>
        <div class="field-row"><span class="field-label">P. PARTIDA:</span><span class="field-value">${(doc.metadata as any)?.guia_datos?.punto_partida?.direccion || company.direccion} (Ubigeo: ${(doc.metadata as any)?.guia_datos?.punto_partida?.ubigeo || company.ubigeo})</span></div>
        <div class="field-row"><span class="field-label">P. LLEGADA:</span><span class="field-value">${(doc.metadata as any)?.guia_datos?.punto_llegada?.direccion || doc.client_address || '-'} (Ubigeo: ${(doc.metadata as any)?.guia_datos?.punto_llegada?.ubigeo || '150101'})</span></div>
        ${(doc.metadata as any)?.guia_datos?.modalidad_traslado === '01'
          ? `<div class="field-row"><span class="field-label">TRANSPORTISTA:</span><span class="field-value">${(doc.metadata as any)?.guia_datos?.transportista?.razon_social || '-'} (RUC: ${(doc.metadata as any)?.guia_datos?.transportista?.numero_documento || '-'})</span></div>`
          : `<div class="field-row"><span class="field-label">CONDUCTOR:</span><span class="field-value">${(doc.metadata as any)?.guia_datos?.conductor?.nombre_completo || (doc.metadata as any)?.guia_datos?.conductor?.nombres || '-'} (Lic: ${(doc.metadata as any)?.guia_datos?.conductor?.licencia || '-'})</span></div>
             <div class="field-row"><span class="field-label">VEHÍCULO PLACA:</span><span class="field-value font-mono font-bold">${(doc.metadata as any)?.guia_datos?.vehiculo?.placa || '-'}</span></div>`
        }
      </div>
    </div>
    ` : ''}

    <table class="items-table">
      <thead>
        ${doc.document_type === '09' ? `
        <tr>
          <th style="width: 35px;" class="text-center">#</th>
          <th style="width: 100px;">CÓDIGO</th>
          <th>DESCRIPCIÓN DEL BIEN A TRASLADAR</th>
          <th style="width: 80px;" class="text-center">UNIDAD</th>
          <th style="width: 100px;" class="text-right">CANTIDAD</th>
        </tr>
        ` : `
        <tr>
          <th style="width: 35px;" class="text-center">#</th>
          <th style="width: 70px;">CÓDIGO</th>
          <th>DESCRIPCIÓN</th>
          <th style="width: 50px;" class="text-center">UND</th>
          <th style="width: 65px;" class="text-right">CANT.</th>
          <th style="width: 85px;" class="text-right">V. UNIT</th>
          <th style="width: 85px;" class="text-right">P. UNIT</th>
          <th style="width: 90px;" class="text-right">TOTAL</th>
        </tr>
        `}
      </thead>
      <tbody>
        ${(doc.items || []).map((it, idx) => doc.document_type === '09' ? `
          <tr>
            <td class="text-center" style="color: #94a3b8;">${idx + 1}</td>
            <td style="font-family: monospace;">${it.code || '-'}</td>
            <td><b>${it.description}</b></td>
            <td class="text-center">${it.unit_measure}</td>
            <td class="text-right"><b>${Number(it.quantity).toFixed(2)}</b></td>
          </tr>
        ` : `
          <tr>
            <td class="text-center" style="color: #94a3b8;">${idx + 1}</td>
            <td style="font-family: monospace;">${it.code || '-'}</td>
            <td><b>${it.description}</b></td>
            <td class="text-center">${it.unit_measure}</td>
            <td class="text-right">${Number(it.quantity).toFixed(2)}</td>
            <td class="text-right">${Number(it.unit_value).toFixed(2)}</td>
            <td class="text-right">${Number(it.unit_price).toFixed(2)}</td>
            <td class="text-right"><b>${Number(it.total).toFixed(2)}</b></td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    ${doc.document_type === '09' ? '' : `
    <div class="words-box">
      SON: ${words}
    </div>
    `}

    <div class="footer-area">
      <div class="qr-info-block">
        ${qrDataUrl ? `<img class="qr-img" src="${qrDataUrl}" alt="QR Oficial SUNAT" />` : ''}
        <div class="audit-meta">
          <b>Código Hash SHA-256:</b><br>
          <span style="font-family: monospace; color: #1e293b;">${doc.xml_digest_value || 'PENDIENTE DE FIRMA'}</span><br><br>
          <b>Estado SUNAT:</b> <span class="badge-accepted">${doc.status}</span><br>
          ${doc.sunat_description ? '<i>' + doc.sunat_description + '</i><br>' : ''}
          <b>Autorización:</b> Emisión autorizada según Resolución de Superintendencia SUNAT.
        </div>
      </div>

      <div class="totals-area">
        ${doc.document_type === '09' ? `
          <div class="total-row"><span>PESO BRUTO TOTAL:</span><span class="font-bold">${(doc.metadata as any)?.guia_datos?.peso_bruto_total || 1} ${(doc.metadata as any)?.guia_datos?.unidad_peso || 'KGM'}</span></div>
          <div class="total-row"><span>N° DE BULTOS:</span><span class="font-bold">${(doc.metadata as any)?.guia_datos?.numero_bultos || 1}</span></div>
          <div class="total-row grand-total"><span>TOTAL ÍTEMS:</span><span>${doc.items?.length || 0} BIENES</span></div>
        ` : `
          ${Number(doc.total_gravada) > 0 ? `<div class="total-row"><span>OP. GRAVADA:</span><span>${Number(doc.total_gravada).toFixed(2)}</span></div>` : ''}
          ${Number(doc.total_exonerada) > 0 ? `<div class="total-row"><span>OP. EXONERADA:</span><span>${Number(doc.total_exonerada).toFixed(2)}</span></div>` : ''}
          ${Number(doc.total_inafecta) > 0 ? `<div class="total-row"><span>OP. INAFECTA:</span><span>${Number(doc.total_inafecta).toFixed(2)}</span></div>` : ''}
          <div class="total-row"><span>I.G.V. (${Number(doc.total_igv) > 0 ? (doc.items?.[0]?.igv_percentage || 18) + '%' : '0%'}):</span><span>${Number(doc.total_igv).toFixed(2)}</span></div>
          <div class="total-row grand-total"><span>TOTAL:</span><span>${doc.currency === 'PEN' ? 'S/ ' : '$ '}${Number(doc.total_amount).toFixed(2)}</span></div>
        `}
      </div>
    </div>

    ${Number(doc.total_exonerada) > 0 ? `
    <div style="margin: 12px 0 6px 0; padding: 7px 12px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; font-weight: 700; color: #166534; font-size: 11px; text-align: center; letter-spacing: 0.3px;">
      BIENES TRANSFERIDOS EN LA AMAZONÍA PARA SER CONSUMIDOS EN LA MISMA - LEY N° 27037
    </div>` : ''}

    <div class="legal-notice">
      Representación impresa de Comprobante de Pago Electrónico generado conforme a las especificaciones técnicas de SUNAT UBL 2.1.<br>
      Consulte la autenticidad y validez de este documento mediante el código QR o en la plataforma oficial de SUNAT.
    </div>
  </div>
</body>
</html>`;
  }

  private renderTicket(
    doc: DocumentWithItems,
    company: Company,
    qrDataUrl: string,
    docTitle: string,
    words: string,
  ): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Ticket ${doc.full_number}</title>
  <style>
    @page { margin: 0; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 11px; width: 72mm; margin: 0 auto; padding: 10px 4px; color: #000; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { padding: 3px 0; }
    .qr { width: 135px; height: 135px; margin: 8px auto; display: block; }
  </style>
</head>
<body>
  <div class="text-center bold" style="font-size: 13px;">${company.razon_social}</div>
  <div class="text-center">RUC: ${company.ruc}</div>
  <div class="text-center">${company.direccion}</div>
  <div class="text-center">${company.distrito} - ${company.provincia}</div>
  <div class="divider"></div>
  <div class="text-center bold">${docTitle}</div>
  <div class="text-center bold" style="font-size: 15px;">${doc.full_number}</div>
  <div class="divider"></div>
  <div><b>FECHA:</b> ${doc.issue_date} ${doc.issue_time}</div>
  <div><b>CLIENTE:</b> ${doc.client_name}</div>
  <div><b>DOC:</b> ${doc.client_doc_number}</div>
  <div><b>FORMA PAGO:</b> ${doc.payment_type}</div>
  ${doc.ref_series && doc.ref_number ? `
  <div style="margin-top: 3px; padding-top: 3px; border-top: 1px dotted #ccc;">
    <div><b>DOC. AFECTADO:</b> ${doc.ref_series}-${String(doc.ref_number).padStart(8, '0')}</div>
    <div><b>MOTIVO SUNAT:</b> [${doc.ref_reason_code || '01'}] ${doc.ref_reason_desc || 'AJUSTE / ANULACION'}</div>
  </div>` : ''}
  <div class="divider"></div>
  <table>
    <thead>
      <tr>
        <th align="left">DESCRIPCIÓN</th>
        <th align="right">CANT</th>
        <th align="right">TOTAL</th>
      </tr>
    </thead>
    <tbody>
      ${(doc.items || []).map(it => `
        <tr>
          <td colspan="3"><b>${it.description}</b></td>
        </tr>
        <tr>
          <td>${it.unit_measure} @ ${Number(it.unit_price).toFixed(2)}</td>
          <td align="right">${Number(it.quantity).toFixed(2)}</td>
          <td align="right" class="bold">${Number(it.total).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="divider"></div>
  <table>
    ${Number(doc.total_gravada) > 0 ? `<tr><td>OP. GRAVADA:</td><td class="text-right">${Number(doc.total_gravada).toFixed(2)}</td></tr>` : ''}
    ${Number(doc.total_exonerada) > 0 ? `<tr><td>OP. EXONERADA:</td><td class="text-right">${Number(doc.total_exonerada).toFixed(2)}</td></tr>` : ''}
    ${Number(doc.total_inafecta) > 0 ? `<tr><td>OP. INAFECTA:</td><td class="text-right">${Number(doc.total_inafecta).toFixed(2)}</td></tr>` : ''}
    <tr><td>I.G.V. (${Number(doc.total_igv) > 0 ? (doc.items?.[0]?.igv_percentage || 18) + '%' : '0%'}):</td><td class="text-right">${Number(doc.total_igv).toFixed(2)}</td></tr>
    <tr class="bold" style="font-size: 13px;"><td>TOTAL:</td><td class="text-right">${doc.currency} ${Number(doc.total_amount).toFixed(2)}</td></tr>
  </table>
  ${Number(doc.total_exonerada) > 0 ? `
  <div class="divider"></div>
  <div class="text-center bold" style="font-size: 8px; padding: 2px 0;">BIENES TRANSFERIDOS EN LA AMAZON\u00cdA PARA SER CONSUMIDOS EN LA MISMA - LEY N\u00b0 27037</div>
  ` : ''}
  <div class="divider"></div>
  <div style="font-size: 9px;">SON: ${words}</div>
  <div class="divider"></div>
  ${qrDataUrl ? `<img class="qr" src="${qrDataUrl}" alt="QR" />` : ''}
  <div class="text-center" style="font-size: 8px;">Hash: ${doc.xml_digest_value || '-'}</div>
  <div class="text-center" style="font-size: 8px; margin-top: 4px;">Representación impresa de Comprobante Electrónico conforme a SUNAT UBL 2.1</div>
</body>
</html>`;
  }
}
