import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../../../core/config/env.js';
import { RefreshTokenRepository } from './refresh-token.repository.js';

/** Two tabs refreshing at once reuse a token for a few seconds: not theft. */
export const REUSE_GRACE_MS = 10_000;
const DAY_MS = 24 * 3600_000;

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
  persistent: boolean;
}

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly tokens: RefreshTokenRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(
    userId: string,
    options: { persistent: boolean; userAgent?: string; familyId?: string },
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const days = options.persistent
      ? this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true })
      : 1;
    const expiresAt = new Date(Date.now() + days * DAY_MS);
    await this.tokens.create({
      userId,
      tokenHash: hash(token),
      familyId: options.familyId ?? randomUUID(),
      persistent: options.persistent,
      expiresAt,
      userAgent: options.userAgent?.slice(0, 255),
    });
    return { token, expiresAt, persistent: options.persistent };
  }

  async rotate(
    raw: string,
    userAgent?: string,
  ): Promise<{ userId: string; token: IssuedRefreshToken }> {
    const now = new Date();
    const row = await this.tokens.findByHash(hash(raw));
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    if (row.revokedAt) {
      if (now.getTime() - row.revokedAt.getTime() > REUSE_GRACE_MS) {
        await this.tokens.revokeFamily(row.familyId, now);
      }
      throw new UnauthorizedException('Refresh token already used');
    }
    if (row.expiresAt <= now)
      throw new UnauthorizedException('Refresh token expired');
    if (!(await this.tokens.revokeIfActive(row.id, now))) {
      throw new UnauthorizedException('Refresh token already used');
    }
    const token = await this.issue(row.userId, {
      persistent: row.persistent,
      userAgent,
      familyId: row.familyId,
    });
    return { userId: row.userId, token };
  }

  async revokeFamilyOf(raw: string): Promise<void> {
    const row = await this.tokens.findByHash(hash(raw));
    if (row) await this.tokens.revokeFamily(row.familyId, new Date());
  }
}
