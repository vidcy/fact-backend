import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'NuevaClave2026!', minLength: 6, description: 'Nueva contraseña del usuario' })
  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener un mínimo de 6 caracteres.' })
  @IsNotEmpty({ message: 'La nueva contraseña es obligatoria.' })
  newPassword: string;
}
