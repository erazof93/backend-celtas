import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, FindOptionsWhere, ILike, Raw, Repository } from 'typeorm';
import {
  INVALID_PHONE_MESSAGE,
  normalizePhone,
} from '../../common/utils/phone.util';
import { QueryUsersDto, SortOrder, UsersSortBy } from './dto/query-users.dto';
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
  phone?: string | null;
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
      phone: data.phone ? this.normalizePhoneOrReject(data.phone) : null,
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
    const patch: UpdateProfileData = {};
    if (data.fullName !== undefined) {
      patch.fullName = data.fullName;
    }
    if (data.phone !== undefined) {
      // null sigue borrando el teléfono (el DTO lo permite con @IsOptional).
      patch.phone =
        data.phone === null ? null : this.normalizePhoneOrReject(data.phone);
    }
    if (Object.keys(patch).length === 0) return user;
    await this.usersRepository.update(userId, patch);
    return this.getProfile(userId);
  }

  /**
   * Teléfono tal como se guarda (código de país + número, sin +: 51XXXXXXXXX,
   * 584129999999…), el formato que exige wa.me. Los DTOs ya validan con
   * `IsPhone`; esto es la defensa en profundidad para cualquier otro caller.
   */
  private normalizePhoneOrReject(phone: string): string {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new BadRequestException(INVALID_PHONE_MESSAGE);
    }
    return normalized;
  }

  /**
   * `?search=` de GET /users: nombre o email que CONTENGAN el texto (ILIKE), o
   * teléfono que contenga sus dígitos. El teléfono se compara solo por dígitos en
   * ambos lados (`regexp_replace`), así también encuentra los guardados antes de
   * la normalización con formato libre ("+51 999-555-123"). Desde 3 dígitos, para
   * que "a1" no traiga a todos los que tengan un 1 en el teléfono.
   */
  private buildSearchWhere(
    search: string | undefined,
  ): FindOptionsWhere<User>[] | undefined {
    if (!search) return undefined;
    // % y _ son comodines de LIKE: se escapan para que "search=%" no traiga a todos.
    const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const conditions: FindOptionsWhere<User>[] = [
      { fullName: ILike(like) },
      { email: ILike(like) },
    ];
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) {
      conditions.push({
        phone: Raw(
          (alias) =>
            `regexp_replace(${alias}, '\\D', '', 'g') LIKE :phoneDigits`,
          { phoneDigits: `%${digits}%` },
        ),
      });
    }
    return conditions;
  }

  /**
   * Guarda/actualiza el token FCM del dispositivo actual. Single-device por
   * ahora: sobrescribe el token anterior (el último dispositivo gana).
   */
  async updateFcmToken(userId: string, fcmToken: string): Promise<User> {
    await this.getProfile(userId);
    await this.usersRepository.update(userId, { fcmToken });
    return this.getProfile(userId);
  }

  /**
   * Borra el token FCM del dispositivo actual (al cerrar sesión). Deja
   * `fcmToken = null` para que el backend no le mande más notificaciones push a
   * ese dispositivo — importante en celulares compartidos, donde el próximo
   * usuario que inicie sesión no debe recibir notificaciones de la cuenta
   * anterior. Es best-effort desde la app; si no se llama, el token se
   * sobrescribe igual en el próximo `updateFcmToken`.
   */
  async clearFcmToken(userId: string): Promise<User> {
    await this.getProfile(userId);
    await this.usersRepository.update(userId, { fcmToken: null });
    return this.getProfile(userId);
  }

  /**
   * Listado paginado de usuarios para el panel admin. `sortBy`/`order` son
   * opcionales (whitelist validada en el DTO); sin `sortBy` el comportamiento
   * previo (createdAt DESC) queda intacto.
   */
  async findAll(query: QueryUsersDto): Promise<PaginatedUsers> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sortColumn = query.sortBy ?? UsersSortBy.CREATED_AT;
    const direction = (query.order ?? SortOrder.DESC).toUpperCase() as
      'ASC' | 'DESC';

    const [items, total] = await this.usersRepository.findAndCount({
      where: this.buildSearchWhere(query.search),
      take: limit,
      skip: (page - 1) * limit,
      order: { [sortColumn]: direction },
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
    await this.usersRepository.update(targetId, { role });
    const updated = await this.findById(targetId);
    if (!updated) throw new NotFoundException('Usuario no encontrado');
    return updated;
  }
}
