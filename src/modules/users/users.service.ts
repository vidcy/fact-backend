import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger('CCOFACT-UsersService');

  constructor(private readonly prisma: PrismaService) {}

  private formatUser(u: any) {
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      company_id: u.company_id,
      companyId: u.company_id,
      company: u.company
        ? {
            id: u.company.id,
            ruc: u.company.ruc,
            razon_social: u.company.razon_social,
            razonSocial: u.company.razon_social,
          }
        : null,
      is_active: u.is_active,
      isActive: u.is_active,
      created_at: u.created_at,
      createdAt: u.created_at,
      updated_at: u.updated_at,
      updatedAt: u.updated_at,
    };
  }

  /**
   * Lista todos los usuarios de la plataforma con su empresa vinculada
   */
  async findAll() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        company_id: true,
        company: {
          select: {
            id: true,
            ruc: true,
            razon_social: true,
          },
        },
        is_active: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { created_at: 'desc' },
    });

    return users.map((u) => this.formatUser(u));
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
        company_id: true,
        company: {
          select: {
            id: true,
            ruc: true,
            razon_social: true,
          },
        },
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado.`);
    }

    return this.formatUser(user);
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
        password_hash: passwordHash,
        name: dto.name.trim(),
        role: dto.role || 'ADMIN',
        company_id: dto.companyId || null,
        is_active: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        company_id: true,
        company: {
          select: {
            id: true,
            ruc: true,
            razon_social: true,
          },
        },
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    this.logger.log(`Usuario creado exitosamente: ${newUser.email} (${newUser.role})`);
    return this.formatUser(newUser);
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
    if (dto.companyId !== undefined) dataToUpdate.company_id = dto.companyId || null;
    if (dto.isActive !== undefined) dataToUpdate.is_active = dto.isActive;

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: dataToUpdate,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        company_id: true,
        company: {
          select: {
            id: true,
            ruc: true,
            razon_social: true,
          },
        },
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    return this.formatUser(updatedUser);
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
      data: { password_hash: passwordHash },
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
