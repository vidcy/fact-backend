import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ConsultasService {
  private readonly logger = new Logger('CCOFACT-Consultas');

  constructor(private readonly prisma: PrismaService) {}

  async consultarRuc(rucInput: string) {
    const ruc = (rucInput || '').trim().replace(/\D/g, '');
    if (!ruc || ruc.length !== 11) {
      throw new BadRequestException('El RUC debe tener exactamente 11 dígitos numéricos.');
    }

    // 1. Comprobar si es una empresa registrada en CCOFACT
    const localCompany = await this.prisma.company.findUnique({
      where: { ruc },
    });

    let sunatData: any = null;

    if (localCompany) {
      sunatData = {
        razon_social: localCompany.razon_social,
        nombre_comercial: localCompany.nombre_comercial || localCompany.razon_social,
        direccion: localCompany.direccion || '',
        ubigeo: localCompany.ubigeo || '',
        estado: 'ACTIVO',
        condicion: 'HABIDO',
      };
    }

    // 2. OpenRUC para personas jurídicas (RUC 20)
    if (!sunatData && ruc.startsWith('20')) {
      try {
        const respOpen = await fetch(`https://openruc.com/api/ruc/${ruc}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(4500),
        });
        if (respOpen.ok) {
          const openData = await respOpen.json();
          if (openData && (openData.razon_social || openData.nombre_o_razon_social)) {
            sunatData = {
              razon_social: openData.razon_social || openData.nombre_o_razon_social,
              nombre_comercial: openData.nombre_comercial || openData.razon_social,
              direccion: openData.direccion || openData.direccion_completa || '',
              ubigeo: openData.ubigeo || '',
              estado: openData.estado || 'ACTIVO',
              condicion: openData.condicion || 'HABIDO',
            };
          }
        }
      } catch (_) {}
    }

    // 3. apis.net.pe v1
    if (!sunatData) {
      try {
        const resp = await fetch(`https://api.apis.net.pe/v1/ruc?numero=${ruc}`, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(4500),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && (data.nombre || data.razonSocial)) {
            sunatData = {
              razon_social: data.nombre || data.razonSocial,
              nombre_comercial: data.nombreComercial || data.nombre || data.razonSocial,
              direccion: data.direccion && data.direccion !== '-' ? data.direccion : '',
              departamento: data.departamento || '',
              provincia: data.provincia || '',
              distrito: data.distrito || '',
              ubigeo: data.ubigeo && data.ubigeo !== '-' ? data.ubigeo : '',
              estado: data.estado || 'ACTIVO',
              condicion: data.condicion || 'HABIDO',
            };
          }
        }
      } catch (_) {}
    }

    // 4. Si es RUC 10 y no hay datos, consultar DNI en RENIEC
    if (!sunatData && ruc.startsWith('10')) {
      const dni = ruc.substring(2, 10);
      try {
        const respDni = await fetch(`https://api.apis.net.pe/v1/dni?numero=${dni}`, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(4000),
        });
        if (respDni.ok) {
          const dniData = await respDni.json();
          const fullName = `${dniData.nombres || ''} ${dniData.apellidoPaterno || ''} ${dniData.apellidoMaterno || ''}`.trim();
          if (fullName) {
            sunatData = {
              razon_social: fullName,
              nombre_comercial: fullName,
              direccion: '',
              departamento: '',
              provincia: '',
              distrito: '',
              ubigeo: '',
              estado: 'ACTIVO',
              condicion: 'HABIDO',
            };
          }
        }
      } catch (_) {}
    }

    if (!sunatData) {
      throw new NotFoundException(`No se encontraron datos oficiales en SUNAT para el RUC ${ruc}.`);
    }

    let razonSocial = sunatData.razon_social || sunatData.razonSocial || sunatData.nombre || '';
    let nombreComercial = sunatData.nombre_comercial || sunatData.nombreComercial || razonSocial;
    let rawAddress = sunatData.direccion || sunatData.domicilio_fiscal || '';
    if (localCompany && (!rawAddress || rawAddress === '-' || rawAddress === '--')) {
      rawAddress = localCompany.direccion || '';
    }

    let ubigeo = sunatData.ubigeo || localCompany?.ubigeo || '';
    let departamento = sunatData.departamento || '';
    let provincia = sunatData.provincia || '';
    let distrito = sunatData.distrito || '';

    // Mapeo nacional de ubigeos clave
    const UBIGEOS: Record<string, { dpto: string; prov: string; dist: string }> = {
      '170101': { dpto: 'MADRE DE DIOS', prov: 'TAMBOPATA', dist: 'TAMBOPATA' },
      '170102': { dpto: 'MADRE DE DIOS', prov: 'TAMBOPATA', dist: 'INAMBARI' },
      '170103': { dpto: 'MADRE DE DIOS', prov: 'TAMBOPATA', dist: 'LAS PIEDRAS' },
      '170104': { dpto: 'MADRE DE DIOS', prov: 'TAMBOPATA', dist: 'LABERINTO' },
      '170201': { dpto: 'MADRE DE DIOS', prov: 'MANU', dist: 'MANU' },
      '170301': { dpto: 'MADRE DE DIOS', prov: 'TAHUAMANU', dist: 'IÑAPARI' },
      '170302': { dpto: 'MADRE DE DIOS', prov: 'TAHUAMANU', dist: 'IBERIA' },
      '211101': { dpto: 'PUNO', prov: 'SAN ROMAN', dist: 'JULIACA' },
      '210101': { dpto: 'PUNO', prov: 'PUNO', dist: 'PUNO' },
      '150101': { dpto: 'LIMA', prov: 'LIMA', dist: 'LIMA' },
      '150114': { dpto: 'LIMA', prov: 'LIMA', dist: 'LA MOLINA' },
      '150122': { dpto: 'LIMA', prov: 'LIMA', dist: 'MIRAFLORES' },
      '150131': { dpto: 'LIMA', prov: 'LIMA', dist: 'SAN ISIDRO' },
      '150140': { dpto: 'LIMA', prov: 'LIMA', dist: 'SANTIAGO DE SURCO' },
      '150130': { dpto: 'LIMA', prov: 'LIMA', dist: 'SAN BORJA' },
      '150141': { dpto: 'LIMA', prov: 'LIMA', dist: 'SURQUILLO' },
      '080101': { dpto: 'CUSCO', prov: 'CUSCO', dist: 'CUSCO' },
      '040101': { dpto: 'AREQUIPA', prov: 'AREQUIPA', dist: 'AREQUIPA' },
      '160101': { dpto: 'LORETO', prov: 'MAYNAS', dist: 'IQUITOS' },
      '220901': { dpto: 'SAN MARTIN', prov: 'SAN MARTIN', dist: 'TARAPOTO' },
      '250101': { dpto: 'UCAYALI', prov: 'CORONEL PORTILLO', dist: 'CALLERIA' },
    };

    const DEPT_CODES: Record<string, string> = {
      '01': 'AMAZONAS', '02': 'ANCASH', '03': 'APURIMAC', '04': 'AREQUIPA',
      '05': 'AYACUCHO', '06': 'CAJAMARCA', '07': 'CALLAO', '08': 'CUSCO',
      '09': 'HUANCAVELICA', '10': 'HUANUCO', '11': 'ICA', '12': 'JUNIN',
      '13': 'LA LIBERTAD', '14': 'LAMBAYEQUE', '15': 'LIMA', '16': 'LORETO',
      '17': 'MADRE DE DIOS', '18': 'MOQUEGUA', '19': 'PASCO', '20': 'PIURA',
      '21': 'PUNO', '22': 'SAN MARTIN', '23': 'TACNA', '24': 'TUMBES', '25': 'UCAYALI'
    };

    const cleanUbi = ubigeo.replace(/\D/g, '');
    if (cleanUbi && UBIGEOS[cleanUbi]) {
      departamento = departamento || UBIGEOS[cleanUbi].dpto;
      provincia = provincia || UBIGEOS[cleanUbi].prov;
      distrito = distrito || UBIGEOS[cleanUbi].dist;
    } else if (cleanUbi.length >= 2 && !departamento) {
      const code = cleanUbi.substring(0, 2);
      if (DEPT_CODES[code]) departamento = DEPT_CODES[code];
    }

    let cleanAddress = rawAddress;
    if (rawAddress.includes(' - ')) {
      const parts = rawAddress.split(' - ').map((p: string) => p.trim()).filter(Boolean);
      if (parts.length >= 4) {
        departamento = departamento || parts[parts.length - 1].toUpperCase();
        provincia = provincia || parts[parts.length - 2].toUpperCase();
        distrito = distrito || parts[parts.length - 3].toUpperCase();
        cleanAddress = parts.slice(0, parts.length - 3).join(' - ');
      }
    }

    const upperAddr = cleanAddress.toUpperCase();
    if (!departamento || !distrito) {
      if (upperAddr.includes('JULIACA')) {
        distrito = distrito || 'JULIACA';
        provincia = provincia || 'SAN ROMAN';
        departamento = 'PUNO';
      } else if (upperAddr.includes('PUERTO MALDONADO') || upperAddr.includes('TAMBOPATA')) {
        distrito = distrito || 'TAMBOPATA';
        provincia = provincia || 'TAMBOPATA';
        departamento = 'MADRE DE DIOS';
      } else if (upperAddr.includes('IQUITOS')) {
        distrito = distrito || 'IQUITOS';
        provincia = provincia || 'MAYNAS';
        departamento = 'LORETO';
      } else if (upperAddr.includes('TARAPOTO')) {
        distrito = distrito || 'TARAPOTO';
        provincia = provincia || 'SAN MARTIN';
        departamento = 'SAN MARTIN';
      } else if (upperAddr.includes('CUSCO')) {
        distrito = distrito || 'CUSCO';
        provincia = provincia || 'CUSCO';
        departamento = 'CUSCO';
      } else if (upperAddr.includes('AREQUIPA')) {
        distrito = distrito || 'AREQUIPA';
        provincia = provincia || 'AREQUIPA';
        departamento = 'AREQUIPA';
      }
    }

    return {
      success: true,
      ruc,
      razon_social: razonSocial,
      razonSocial,
      nombre_comercial: nombreComercial,
      nombreComercial,
      direccion: cleanAddress,
      departamento,
      provincia,
      distrito,
      ubigeo,
      estado: sunatData.estado || 'ACTIVO',
      condicion: sunatData.condicion || 'HABIDO',
    };
  }

  async consultarDni(dniInput: string) {
    const dni = (dniInput || '').trim().replace(/\D/g, '');
    if (!dni || dni.length !== 8) {
      throw new BadRequestException('El DNI debe contener exactamente 8 dígitos numéricos.');
    }

    try {
      const resp = await fetch(`https://api.apis.net.pe/v1/dni?numero=${dni}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(4500),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.nombre) {
          return {
            success: true,
            dni,
            nombre: data.nombre,
            nombres: data.nombres || '',
            apellidoPaterno: data.apellidoPaterno || '',
            apellidoMaterno: data.apellidoMaterno || '',
          };
        }
      }
    } catch (_) {}

    throw new NotFoundException(`No se encontraron datos oficiales en RENIEC para el DNI ${dni}.`);
  }
}
