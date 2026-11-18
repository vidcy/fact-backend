import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

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
  
  // Credenciales maestras del Administrador (configurables en .env como respaldo)
  private readonly masterAdminEmail = (process.env.ADMIN_EMAIL || 'admin@ccoplex.com').trim().toLowerCase();
  private readonly masterAdminPassword = (process.env.ADMIN_PASSWORD || 'admin123').trim();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hashea una contraseña usando scrypt con salt criptográfico de 16 bytes
   */
  public static hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Valida una contraseña contra el hash almacenado en base de datos
   */
  public verifyPassword(password: string, storedHash: string): boolean {
    if (!storedHash) return false;
    if (!storedHash.includes(':')) {
      return password === storedHash;
    }
    try {
      const [salt, originalHash] = storedHash.split(':');
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Autentica las credenciales del Administrador Maestro en la base de datos PostgreSQL.
   * Genera un token criptográfico de sesión firmado con HMAC SHA-256.
   * 
   * @param email Correo o usuario del administrador
   * @param password Contraseña del administrador
   */
  public async loginAdmin(email: string, password: string) {
    const cleanEmail = email?.trim().toLowerCase();
    const cleanPassword = password?.trim();

    if (!cleanEmail || !cleanPassword) {
      throw new UnauthorizedException('Debe ingresar correo y contraseña.');
    }

    // 1. Buscar en la tabla users de la base de datos
    let dbUser = await this.prisma.user.findFirst({
      where: {
        email: cleanEmail,
      },
    });

    // Si el usuario ingresó 'admin' o 'admin@ccoplex.com'
    if (!dbUser && (cleanEmail === 'admin' || cleanEmail.startsWith('admin@'))) {
      dbUser = await this.prisma.user.findFirst({
        where: {
          role: 'SUPER_ADMIN',
        },
      });
    }

    let isValid = false;
    let userId = 'admin-master-001';
    let userName = 'Administrador Maestro';
    let userEmail = this.masterAdminEmail;
    let userRole = 'SUPER_ADMIN';
    let userCompanyId: string | null = null;

    if (dbUser) {
      if (!dbUser.isActive) {
        throw new UnauthorizedException('El usuario administrador se encuentra inactivo.');
      }
      isValid = this.verifyPassword(cleanPassword, dbUser.passwordHash);
      if (isValid) {
        userId = dbUser.id;
        userName = dbUser.name;
        userEmail = dbUser.email;
        userRole = dbUser.role;
        userCompanyId = dbUser.companyId || null;
      }
    } else {
      // Respaldo de seguridad con variables de entorno .env si la tabla users aún no se ha inicializado
      const isEnvUser = (cleanEmail === this.masterAdminEmail || cleanEmail === 'admin@ccofact.pe' || cleanEmail === 'admin');
      const isEnvPass = cleanPassword === this.masterAdminPassword;
      isValid = isEnvUser && isEnvPass;
    }

    if (!isValid) {
      this.logger.warn(`Intento de acceso administrativo fallido para usuario: ${email}`);
      throw new UnauthorizedException('Credenciales de Administrador inválidas. Acceso restringido.');
    }

    // 2. Creación de payload de sesión administrativa
    const payload = {
      sub: userId,
      email: userEmail,
      name: userName,
      role: userRole,
      companyId: userCompanyId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (86400 * 7), // 7 días de vigencia
    };

    // 3. Firma del token mediante HMAC SHA-256
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(encodedPayload)
      .digest('base64url');
    const token = `${encodedPayload}.${signature}`;

    this.logger.log(`Sesión administrativa iniciada exitosamente para ${userEmail}`);

    return {
      success: true,
      token,
      user: {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        companyId: payload.companyId,
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
