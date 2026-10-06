import { ConflictException } from '@nestjs/common';
import { Role, type User } from '../../generated/prisma/client.js';
import type { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

function fakeRepository() {
  const users: User[] = [];
  return {
    users,
    findByEmail: vi.fn(
      async (email: string) => users.find((u) => u.email === email) ?? null,
    ),
    findById: vi.fn(
      async (id: string) => users.find((u) => u.id === id) ?? null,
    ),
    create: vi.fn(
      async (data: Omit<User, 'id' | 'status' | 'createdAt' | 'updatedAt'>) => {
        const user = {
          ...data,
          id: `id-${users.length}`,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as User;
        users.push(user);
        return user;
      },
    ),
  };
}

const input = {
  email: ' Nadege.K@Example.com ',
  firstName: 'Nadège',
  lastName: 'K.',
  role: Role.FAMILY,
  passwordHash: 'hash',
};

const make = () => {
  const repo = fakeRepository();
  return {
    repo,
    service: new UsersService(repo as unknown as UsersRepository),
  };
};

describe('UsersService', () => {
  it('stores the email trimmed and lowercased', async () => {
    const { service } = make();
    expect((await service.create(input)).email).toBe('nadege.k@example.com');
  });

  it('refuses an email already registered, whatever its case', async () => {
    const { service } = make();
    await service.create(input);
    await expect(
      service.create({ ...input, email: 'NADEGE.K@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('finds a user by email typed with capitals and spaces', async () => {
    const { service } = make();
    await service.create(input);
    expect(await service.findByEmail('  NADEGE.K@EXAMPLE.COM')).not.toBeNull();
  });
});
