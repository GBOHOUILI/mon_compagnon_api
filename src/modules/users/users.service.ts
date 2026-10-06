import { ConflictException, Injectable } from '@nestjs/common';
import type { Role, User } from '../../generated/prisma/client.js';
import { UsersRepository } from './users.repository.js';

export interface NewUser {
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  role: Role;
  passwordHash: string;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  findById(id: string) {
    return this.users.findById(id);
  }

  findByEmail(email: string) {
    return this.users.findByEmail(normalizeEmail(email));
  }

  async create(input: NewUser): Promise<User> {
    const email = normalizeEmail(input.email);
    if (await this.users.findByEmail(email)) {
      throw new ConflictException('Email already registered');
    }
    return this.users.create({ ...input, email });
  }

  /** Seed only: creates the user once, leaves an existing one untouched. */
  ensure(input: NewUser): Promise<User> {
    return this.users.upsertByEmail({
      ...input,
      email: normalizeEmail(input.email),
    });
  }
}
