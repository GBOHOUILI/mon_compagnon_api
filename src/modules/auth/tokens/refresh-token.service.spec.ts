import { UnauthorizedException } from '@nestjs/common';
import type { RefreshToken } from '../../../generated/prisma/client.js';
import type { RefreshTokenRepository } from './refresh-token.repository.js';
import {
  REUSE_GRACE_MS,
  RefreshTokenService,
} from './refresh-token.service.js';

function fakeRepository() {
  const rows: RefreshToken[] = [];
  return {
    rows,
    create: vi.fn(
      async (data: Omit<RefreshToken, 'id' | 'createdAt' | 'revokedAt'>) => {
        const row = {
          ...data,
          id: `t${rows.length}`,
          createdAt: new Date(),
          revokedAt: null,
        } as RefreshToken;
        rows.push(row);
        return row;
      },
    ),
    findByHash: vi.fn(
      async (hash: string) => rows.find((r) => r.tokenHash === hash) ?? null,
    ),
    revokeIfActive: vi.fn(async (id: string, at: Date) => {
      const row = rows.find((r) => r.id === id && r.revokedAt === null);
      if (!row) return false;
      row.revokedAt = at;
      return true;
    }),
    revokeFamily: vi.fn(async (familyId: string, at: Date) => {
      rows
        .filter((r) => r.familyId === familyId && !r.revokedAt)
        .forEach((r) => (r.revokedAt = at));
    }),
  };
}

const config = { get: () => 30 };
const make = () => {
  const repo = fakeRepository();
  return {
    repo,
    service: new RefreshTokenService(
      repo as unknown as RefreshTokenRepository,
      config as never,
    ),
  };
};
const DAY = 24 * 3600_000;

describe('RefreshTokenService', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-06T10:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('stores only a hash of the token', async () => {
    const { repo, service } = make();
    const issued = await service.issue('u1', { persistent: true });
    expect(repo.rows[0].tokenHash).not.toBe(issued.token);
    expect(issued.token.length).toBeGreaterThanOrEqual(43);
  });

  it('lasts 30 days when persistent, 1 day otherwise', async () => {
    const { service } = make();
    const persistent = await service.issue('u1', { persistent: true });
    const session = await service.issue('u1', { persistent: false });
    expect(persistent.expiresAt.getTime() - Date.now()).toBe(30 * DAY);
    expect(session.expiresAt.getTime() - Date.now()).toBe(DAY);
  });

  it('rotates: old token revoked, new one keeps family and persistence', async () => {
    const { repo, service } = make();
    const first = await service.issue('u1', { persistent: true });
    const { userId, token } = await service.rotate(first.token);
    expect(userId).toBe('u1');
    expect(token.persistent).toBe(true);
    expect(repo.rows[0].revokedAt).not.toBeNull();
    expect(repo.rows[1].familyId).toBe(repo.rows[0].familyId);
  });

  it('rejects an unknown token', async () => {
    await expect(make().service.rotate('nope')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const { service } = make();
    const t = await service.issue('u1', { persistent: false });
    vi.advanceTimersByTime(DAY + 1);
    await expect(service.rotate(t.token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('within the grace window, a reused token is refused but the family survives', async () => {
    const { repo, service } = make();
    const first = await service.issue('u1', { persistent: true });
    await service.rotate(first.token);
    vi.advanceTimersByTime(REUSE_GRACE_MS - 1);
    await expect(service.rotate(first.token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repo.rows[1].revokedAt).toBeNull();
  });

  it('after the grace window, reuse revokes the whole family', async () => {
    const { repo, service } = make();
    const first = await service.issue('u1', { persistent: true });
    await service.rotate(first.token);
    vi.advanceTimersByTime(REUSE_GRACE_MS + 1);
    await expect(service.rotate(first.token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repo.rows[1].revokedAt).not.toBeNull();
  });

  it('two concurrent rotations of the same token: only one succeeds', async () => {
    const { service } = make();
    const first = await service.issue('u1', { persistent: true });
    const results = await Promise.allSettled([
      service.rotate(first.token),
      service.rotate(first.token),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});
