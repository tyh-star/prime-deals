import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { QueryFailedError, Repository } from 'typeorm';
import { Role, User } from './user.entity';

const BCRYPT_ROUNDS = 10;

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err.driverError as { code?: string; constraint?: string };
  return driverError?.code === '23505' && (!constraint || driverError.constraint === constraint);
}

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async create(input: {
    username: string;
    password: string;
    phone?: string | null;
    role: Role;
  }): Promise<User> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    try {
      const saved = await this.users.save(
        this.users.create({
          username: input.username,
          passwordHash,
          phone: input.phone ?? null,
          role: input.role,
        }),
      );
      return this.findById(saved.id) as Promise<User>;
    } catch (err) {
      if (isUniqueViolation(err, 'uq_users_username')) {
        throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'Username is already taken' });
      }
      throw err;
    }
  }

  findById(id: number): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  /** Returns the user including the password hash, for credential checks only. */
  findWithPassword(username: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.username = :username', { username })
      .getOne();
  }

  verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async list(page: number, pageSize: number) {
    const [items, total] = await this.users.findAndCount({
      order: { id: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  /** Create the account if the username is free; used for bootstrap admin/demo users. */
  async ensure(username: string, password: string, role: Role): Promise<User> {
    const existing = await this.users.findOne({ where: { username } });
    if (existing) return existing;
    try {
      return await this.create({ username, password, role });
    } catch (err) {
      // Another instance won the race.
      if (err instanceof ConflictException) {
        return (await this.users.findOne({ where: { username } })) as User;
      }
      throw err;
    }
  }
}
