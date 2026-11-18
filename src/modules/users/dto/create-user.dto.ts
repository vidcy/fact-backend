import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'juan.perez@empresa.com', description: 'Correo electrónico único del usuario' })
  @IsEmail({}, { message: 'El correo electrónico ingresado no tiene un formato válido.' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio.' })
  email: string;

  @ApiProperty({ example: 'ClaveSegura2026!', minLength: 6, description: 'Contraseña para inicio de sesión' })
  @IsString()
  @MinLength(6, { message: 'La contraseña debe contener al menos 6 caracteres.' })
  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  password: string;

  @ApiProperty({ example: 'Juan Pérez', description: 'Nombre completo del usuario' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  name: string;

  @ApiPropertyOptional({
    example: 'ADMIN',
    enum: ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'AUDITOR'],
    default: 'ADMIN',
    description: 'Rol del usuario en la plataforma',
  })
  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'AUDITOR'], {
    message: 'El rol debe ser SUPER_ADMIN, ADMIN, OPERATOR o AUDITOR.',
  })
  role?: string;

  @ApiPropertyOptional({
    example: 'd4c3e047-360e-4f20-4221-1910cf3aaaaa',
    description: 'ID de la empresa específica a la que tiene acceso (opcional, null = todas)',
  })
  @IsOptional()
  @IsString()
  companyId?: string;
}
