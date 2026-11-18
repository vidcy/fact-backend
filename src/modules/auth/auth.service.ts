import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * ============================================================================
 * CCOFACT PRO - SERVICIO DE AUTENTICACIÓN ADMINISTRATIVA (CORPORACIÓN CCOPLEX)
 * ============================================================================
 * Gestiona el acceso soberano y exclusivo del Administrador Maestro a la
 * consola central de CCOFACT PRO y a las empresas emisoras multi-tenant.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('CCOFACT-AuthService');

  // Clave secreta para firma y verificación de tokens de sesión
  private readonly jwtSecret = process.env.JWT_SECRET || 'ccofact_sovereign_secret_key_2026_enterprise';
  
  // Credenciales maestras del Administrador (configurables en .env)
  private readonly masterAdminEmail = process.env.ADMIN_EMAIL || 'admin@ccoplex.com';
  private readonly masterAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  /**
   * Autentica las credenciales del Administrador Maestro.
   * Genera un token criptográfico de sesión firmado con HMAC SHA-256.
   * 
   * @param email Correo o usuario del administrador
   * @param password Contraseña del administrador
   */
  public async loginAdmin(email: string, password: string) {
    const cleanEmail = email?.trim().toLowerCase();
    const cleanPassword = password?.trim();

    // Verificación de credenciales maestras (soporta email o username 'admin')
    const isValidUser = (cleanEmail === this.masterAdminEmail || cleanEmail === 'admin@ccofact.pe' || cleanEmail === 'admin');
    const isValidPassword = cleanPassword === this.masterAdminPassword;

    if (!isValidUser || !isValidPassword) {
      this.logger.warn(`Intento de acceso administrativo fallido para usuario: ${email}`);
      throw new UnauthorizedException('Credenciales de Administrador inválidas. Acceso restringido.');
    }

    // Creación de payload de sesión administrativa
    const payload = {
      sub: 'admin-master-001',
      email: this.masterAdminEmail,
      name: 'Administrador Maestro Ccoplex',
      role: 'SUPER_ADMIN',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (86400 * 7), // 7 días de vigencia
    };

    // Firma del token mediante HMAC SHA-256
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(encodedPayload)
      .digest('base64url');
    const token = `${encodedPayload}.${signature}`;

    this.logger.log(`Sesión administrativa iniciada exitosamente para ${this.masterAdminEmail}`);

    return {
      success: true,
      token,
      user: {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      },
      expiresIn: 86400 * 7,
    };
  }

  /**
   * Valida la autenticidad e integridad del token de sesión administrativa.
   * 
   * @param token Cadena del token en formato base64url.signature
   */
  public verifyToken(token: string) {
    if (!token || !token.includes('.')) {
      throw new UnauthorizedException('Token de sesión no proporcionado o formato inválido.');
    }

    const [encodedPayload, signature] = token.split('.');
    const expectedSignature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(encodedPayload)
      .digest('base64url');

    if (signature !== expectedSignature) {
      throw new UnauthorizedException('Firma de token inválida. Sesión comprometida.');
    }

    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new UnauthorizedException('La sesión de Administrador ha expirado. Inicia sesión nuevamente.');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Token de sesión corrupto.');
    }
  }
}

