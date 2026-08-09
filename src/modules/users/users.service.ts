import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';

export interface CreateUserData {
  email: string;
  password: string | null;
  fullName: string;
  provider: 'local' | 'google';
  googleId?: string | null;
  phone?: string | null;
}

export interface UpdateProfileData {
  fullName?: string;
  phone?: string;
}

export interface PaginatedUsers {
  items: User[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Servicio de usuarios: consultas para Auth (findByEmail/findById/create),
 * perfil propio (getProfile/updateProfile) y listado admin (findAll).
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  /**
   * Verifica que el usuario exista (404 si no). Lo usan los endpoints admin que
   * operan sobre un usuario por :id (ej. GET /users/:id/addresses).
   */
  async ensureExists(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
  }

  findByGoogleId(googleId: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { googleId } });
  }

  async create(data: CreateUserData): Promise<User> {
    const user = this.usersRepository.create({
      email: data.email,
      password: data.password,
      fullName: data.fullName,
      provider: data.provider,
      googleId: data.googleId ?? null,
      phone: data.phone ?? null,
    } as DeepPartial<User>);
    return this.usersRepository.save(user);
  }

  /**
   * Perfil del usuario real leído de la BD (no el payload del JWT), para que
   * siempre tenga datos frescos (incluye totalSpent como number vía el transformer).
   * Lo usan GET /users/me y GET /auth/me.
   */
  async getProfile(userId: string): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }
    return user;
  }

  /**
   * Actualiza el perfil propio. Solo acepta los campos del DTO (fullName, phone);
   * email/password/provider/role/totalSpent no son editables aquí.
   */
  async updateProfile(userId: string, data: UpdateProfileData): Promise<User> {
    const user = await this.getProfile(userId);
    if (data.fullName !== undefined) {
      user.fullName = data.fullName;
    }
    if (data.phone !== undefined) {
      user.phone = data.phone;
    }
    return this.usersRepository.save(user);
  }

  /**
   * Guarda/actualiza el token FCM del dispositivo actual. Single-device por
   * ahora: sobrescribe el token anterior (el último dispositivo gana).
   */
  async updateFcmToken(userId: string, fcmToken: string): Promise<User> {
    const user = await this.getProfile(userId);
    user.fcmToken = fcmToken;
    return this.usersRepository.save(user);
  }

  /** Listado paginado de usuarios para el panel admin. */
  async findAll(page = 1, limit = 10): Promise<PaginatedUsers> {
    const [items, total] = await this.usersRepository.findAndCount({
      take: limit,
      skip: (page - 1) * limit,
      order: { createdAt: 'DESC' },
    });

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Cambia el rol de un usuario (solo admin). No se permite que un admin se quite
   * su propio rol de admin (evita dejar el sistema sin administradores por error).
   */
  async updateRole(
    actorId: string,
    targetId: string,
    role: UserRole,
  ): Promise<User> {
    if (actorId === targetId && role !== UserRole.ADMIN) {
      throw new BadRequestException(
        'No puedes quitarte tu propio rol de admin',
      );
    }
    const user = await this.usersRepository.findOne({
      where: { id: targetId },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    user.role = role;
    return this.usersRepository.save(user);
  }
}
