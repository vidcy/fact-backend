import { Controller, Post, Get, Body, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';

/**
 * ============================================================================
 * CCOFACT PRO - CONTROLADOR DE AUTENTICACIÓN (CORPORACIÓN CCOPLEX)
 * ============================================================================
 */
@ApiTags('Seguridad y Autenticación Administrativa')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión como Administrador Maestro de CCOFACT PRO' })
  @ApiResponse({ status: 200, description: 'Sesión iniciada con éxito y token emitido' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  async login(@Body() body: { email?: string; username?: string; password?: string }) {
    const email = body.email || body.username || '';
    const password = body.password || '';
    return this.authService.loginAdmin(email, password);
  }

  @Get('verify')
  @ApiOperation({ summary: 'Verificar validez de token de sesión administrativa' })
  async verify(@Headers('authorization') authHeader: string) {
    const token = authHeader?.replace('Bearer ', '') || '';
    return {
      valid: true,
      user: this.authService.verifyToken(token),
    };
  }
}

