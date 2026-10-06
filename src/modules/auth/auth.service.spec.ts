import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Role, type User } from '../../generated/prisma/client.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { AccessTokenService } from './tokens/access-token.service.js';
import type { RefreshTokenService } from './tokens/refresh-token.service.js';

// ESM namespaces can't be spied on: wrap the real verify in a mock instead.
vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

async function setup(status: User['status'] = 'ACTIVE') {
  const user = {
    id: 'u1',
    email: 'julienne@example.com',
    role: Role.COMPANION,
    status,
    passwordHash: await argon2.hash('correct horse', { type: argon2.argon2id }),
  } as User;
  const users = {
    findByEmail: vi.fn(async (e: string) =>
      e.trim().toLowerCase() === user.email ? user : null,
    ),
    findById: vi.fn(async () => user),
    create: vi.fn(async (input: Partial<User>) => ({ ...user, ...input })),
  };
  const access = { sign: vi.fn(async () => 'access') };
  const refresh = {
    issue: vi.fn(async () => ({
      token: 'r',
      expiresAt: new Date(),
      persistent: false,
    })),
    rotate: vi.fn(async () => ({
      userId: 'u1',
      token: { token: 'r2', expiresAt: new Date(), persistent: true },
    })),
    revokeFamilyOf: vi.fn(async () => undefined),
  };
  const verify = vi.mocked(argon2.verify);
  const service = new AuthService(
    users as unknown as UsersService,
    access as unknown as AccessTokenService,
    refresh as unknown as RefreshTokenService,
  );
  return { service, users, refresh, verify };
}

describe('AuthService', () => {
  it('hashes the password with argon2id on register', async () => {
    const { service, users } = await setup();
    await service.register({
      email: 'a@b.c',
      password: '12345678',
      firstName: 'A',
      lastName: 'B',
      role: Role.FAMILY,
    });
    const { passwordHash } = users.create.mock.calls[0][0] as {
      passwordHash: string;
    };
    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('logs in with the right password, whatever the email case', async () => {
    const { service } = await setup();
    const session = await service.login({
      email: ' JULIENNE@example.com',
      password: 'correct horse',
    });
    expect(session.accessToken).toBe('access');
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const { service } = await setup();
    const expected = new UnauthorizedException('Invalid email or password');
    await expect(
      service.login({ email: 'julienne@example.com', password: 'wrong' }),
    ).rejects.toThrow(expected);
    await expect(
      service.login({ email: 'ghost@example.com', password: 'wrong' }),
    ).rejects.toThrow(expected);
  });

  it('still verifies a hash when the email is unknown (no timing leak)', async () => {
    const { service, verify } = await setup();
    verify.mockClear();
    await service
      .login({ email: 'ghost@example.com', password: 'x' })
      .catch(() => undefined);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('refuses a suspended account at login and at refresh', async () => {
    const { service, refresh } = await setup('SUSPENDED');
    await expect(
      service.login({
        email: 'julienne@example.com',
        password: 'correct horse',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.refresh('r')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(refresh.revokeFamilyOf).toHaveBeenCalled();
  });
});
