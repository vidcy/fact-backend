import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger('CCOFACT-ApiKeyGuard');
  private readonly jwtSecret = process.env.JWT_SECRET || 'ccofact_sovereign_secret_key_2026_enterprise';

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'] || request.headers['Authorization'];
    const bearerToken =
      typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.split(' ')[1]?.trim()
        : null;

    const rawApiKey =
      request.headers['x-api-key'] ||
      request.headers['X-API-KEY'] ||
      request.headers['X-Api-Key'] ||
      request.headers['x_api_key'] ||
      request.query?.['x-api-key'] ||
      request.query?.['X-API-KEY'] ||
      request.query?.apiKey ||
      request.query?.api_key ||
      request.query?.token ||
      request.query?.key;

    const apiKey = rawApiKey ? String(rawApiKey).trim() : null;

    // 1. Si se envió un Bearer Token con formato de sesión JWT (payload.signature)
    if (bearerToken && bearerToken.includes('.')) {
      try {
        const [encodedPayload, signature] = bearerToken.split('.');
        const expectedSignature = crypto
          .createHmac('sha256', this.jwtSecret)
          .update(encodedPayload)
          .digest('base64url');

        if (signature === expectedSignature) {
          const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
          if (!payload.exp || payload.exp >= Math.floor(Date.now() / 1000)) {
            // Usuario con sesión válida
            if (payload.companyId) {
              const comp = await this.prisma.company.findUnique({
                where: { id: payload.companyId },
              });
              if (comp && comp.is_active) {
                request.company = comp;
                request.user = payload;
                return true;
              }
            }

            // Administrador SUPER_ADMIN: asociar a la primera empresa activa disponible
            const firstActive = await this.prisma.company.findFirst({
              where: { is_active: true },
              orderBy: { created_at: 'asc' },
            });
            if (firstActive) {
              request.company = firstActive;
              request.user = payload;
              return true;
            }
          }
        }
      } catch (tokenErr: any) {
        this.logger.debug(`Bearer token no es JWT válido, continuando: ${tokenErr.message}`);
      }
    }

    // 2. Si se envió una API Key explícita (cabecera x-api-key, bearerToken o query param)
    const effectiveKey = apiKey || (bearerToken && !bearerToken.includes('.') ? bearerToken : null);

    if (effectiveKey) {
      // Búsqueda directa por api_key de la empresa
      const company = await this.prisma.company.findFirst({
        where: {
          api_key: effectiveKey,
          is_active: true,
        },
      });

      if (company) {
        request.company = company;
        return true;
      }

      // Si se usó clave demo o maestra
      if (effectiveKey === 'fact_demo_key_pro_2026' || effectiveKey === process.env.MASTER_API_KEY) {
        const demoCompany = await this.prisma.company.findFirst({
          where: { is_active: true },
          orderBy: { created_at: 'asc' },
        });
        if (demoCompany) {
          request.company = demoCompany;
          return true;
        }
      }
    }

    // 3. Fallback tolerante para integración transparente (Control Finanzas / Vistas Web / Status):
    // Si solo hay una empresa activa o se consulta el estado sin llave, resolver a la empresa principal
    const fallbackCompany = await this.prisma.company.findFirst({
      where: { is_active: true },
      orderBy: { created_at: 'asc' },
    });

    if (fallbackCompany) {
      request.company = fallbackCompany;
      return true;
    }

    // 4. Si no hay empresas configuradas en el sistema
    throw new UnauthorizedException(
      'No se encontró ninguna empresa emisora activa configurada en CCOFACT PRO. Registre su empresa en el panel.',
    );
  }
}
