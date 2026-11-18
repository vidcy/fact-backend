import { IsEmail, IsOptional, IsString, IsBoolean, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'juan.actualizado@empresa.com' })
  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico ingresado no tiene un formato válido.' })
  email?: string;

  @ApiPropertyOptional({ example: 'Juan Pérez Actualizado' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'OPERATOR',
    enum: ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'AUDITOR'],
  })
  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'AUDITOR'], {
    message: 'El rol debe ser SUPER_ADMIN, ADMIN, OPERATOR o AUDITOR.',
  })
  role?: string;

  @ApiPropertyOptional({
    example: 'd4c3e047-360e-4f20-4221-1910cf3aaaaa',
    description: 'ID de la empresa asignada (o null para acceso global)',
  })
  @IsOptional()
  @IsString()
  companyId?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
