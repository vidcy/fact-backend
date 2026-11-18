import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');

  constructor(private readonly prisma: PrismaService) { }

  /**
   * Lista todos los usuarios registrados en el sistema con su empresa asignada (multi-tenant)
   */
  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
        company: {
          select: {
            id: true,
            ruc: true,
            razonSocial: true,
          },
        },
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Obtiene el detalle de un usuario por su ID
   */
  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
        company: {
          select: {
            id: true,
            ruc: true,
            razonSocial: true,
          },
        },
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    return user;
  }

  /**
   * Registra un nuevo usuario en la plataforma asociado a una empresa o como global
   */
  async create(dto: CreateUserDto) {
    const emailNormalized = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { email: emailNormalized },
    });

    if (existing) {
      throw new ConflictException(`Ya existe un usuario registrado con el correo ${emailNormalized}.`);
    }

    // Si se asignó una empresa, verificar que exista
    if (dto.companyId) {
      const company = await this.prisma.company.findUnique({
        where: { id: dto.companyId },
      });
      if (!company) {
        throw new BadRequestException(`La empresa emisora con ID ${dto.companyId} no existe.`);
      }
    }

    const passwordHash = AuthService.hashPassword(dto.password);

    const newUser = await this.prisma.user.create({
      data: {
        email: emailNormalized,
        passwordHash,
        name: dto.name.trim(),
        role: dto.role || 'ADMIN',
        companyId: dto.companyId || null,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
        company: {
          select: {
            id: true,
            ruc: true,
            razonSocial: true,
          },
        },
        isActive: true,
        createdAt: true,
      },
    });

    this.logger.log(`Usuario creado exitosamente: ${newUser.email} (${newUser.role})`);
    return newUser;
  }

  /**
   * Actualiza los datos de un usuario existente
   */
  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    const dataToUpdate: any = {};

    if (dto.email) {
      const emailNormalized = dto.email.trim().toLowerCase();
      if (emailNormalized !== user.email) {
        const existing = await this.prisma.user.findUnique({
          where: { email: emailNormalized },
        });
        if (existing) {
          throw new ConflictException(`El correo ${emailNormalized} ya se encuentra en uso.`);
        }
        dataToUpdate.email = emailNormalized;
      }
    }

    if (dto.name !== undefined) dataToUpdate.name = dto.name.trim();
    if (dto.role !== undefined) dataToUpdate.role = dto.role;
    if (dto.companyId !== undefined) dataToUpdate.companyId = dto.companyId || null;
    if (dto.isActive !== undefined) dataToUpdate.isActive = dto.isActive;

    return this.prisma.user.update({
      where: { id },
      data: dataToUpdate,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        companyId: true,
        company: {
          select: {
            id: true,
            ruc: true,
            razonSocial: true,
          },
        },
        isActive: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Modifica la contraseña de un usuario aplicando nuevo hash scrypt
   */
  async changePassword(id: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    const passwordHash = AuthService.hashPassword(dto.newPassword);

    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    this.logger.log(`Contraseña actualizada con éxito para el usuario ${user.email}`);
    return { success: true, message: 'Contraseña actualizada correctamente.' };
  }

  /**
   * Elimina un usuario del sistema (impide eliminar al Super Administrador Maestro)
   */
  async remove(id: string, currentUserId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    if (user.role === 'SUPER_ADMIN' && user.email === 'admin@ccoplex.com') {
      throw new BadRequestException('No es posible eliminar al Administrador Maestro del sistema.');
    }

    if (currentUserId && user.id === currentUserId) {
      throw new BadRequestException('No puedes eliminar tu propia cuenta de usuario activa.');
    }

    await this.prisma.user.delete({ where: { id } });
    this.logger.log(`Usuario eliminado: ${user.email} (ID: ${id})`);
    return { success: true, message: `Usuario ${user.email} eliminado exitosamente.` };
  }
}
