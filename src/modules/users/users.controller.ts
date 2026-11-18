import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';

@ApiTags('Gestión de Usuarios y Seguridad RBAC')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los usuarios y operadores del facturador' })
  async findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener información de un usuario específico' })
  async findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Registrar un nuevo usuario u operador con encriptación scrypt' })
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar datos de perfil o rol de un usuario' })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Put(':id/password')
  @ApiOperation({ summary: 'Cambiar la contraseña de un usuario de forma segura' })
  async changePassword(@Param('id') id: string, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un usuario del sistema' })
  async remove(@Param('id') id: string, @Request() req: any) {
    const currentUserId = req?.user?.sub;
    return this.usersService.remove(id, currentUserId);
  }
}
