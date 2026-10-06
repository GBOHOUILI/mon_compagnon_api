import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { User } from '../../generated/prisma/client.js';
import { UsersService } from '../users/users.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { AccessTokenService } from './tokens/access-token.service.js';
import {
  type IssuedRefreshToken,
  RefreshTokenService,
} from './tokens/refresh-token.service.js';

export interface Session {
  user: User;
  accessToken: string;
  refreshToken: IssuedRefreshToken;
}

const INVALID = 'Invalid email or password';
// Verified when the email is unknown, so both paths cost the same time.
const DUMMY_HASH = argon2.hash('timing-equaliser', { type: argon2.argon2id });

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async register(dto: RegisterDto, userAgent?: string): Promise<Session> {
    const { password, ...profile } = dto;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await this.users.create({ ...profile, passwordHash });
    return this.openSession(user, false, userAgent);
  }

  async login(dto: LoginDto, userAgent?: string): Promise<Session> {
    const user = await this.users.findByEmail(dto.email);
    const valid = await argon2.verify(
      user?.passwordHash ?? (await DUMMY_HASH),
      dto.password,
    );
    if (!user || !valid) throw new UnauthorizedException(INVALID);
    if (user.status !== 'ACTIVE')
      throw new ForbiddenException('Account suspended');
    return this.openSession(user, dto.remember ?? false, userAgent);
  }

  async refresh(raw: string, userAgent?: string): Promise<Session> {
    const { userId, token } = await this.refreshTokens.rotate(raw, userAgent);
    const user = await this.users.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.refreshTokens.revokeFamilyOf(token.token);
      throw new ForbiddenException('Account suspended');
    }
    return {
      user,
      accessToken: await this.accessTokens.sign(user),
      refreshToken: token,
    };
  }

  async logout(raw: string | undefined): Promise<void> {
    if (raw) await this.refreshTokens.revokeFamilyOf(raw);
  }

  private async openSession(
    user: User,
    persistent: boolean,
    userAgent?: string,
  ): Promise<Session> {
    const [accessToken, refreshToken] = await Promise.all([
      this.accessTokens.sign(user),
      this.refreshTokens.issue(user.id, { persistent, userAgent }),
    ]);
    return { user, accessToken, refreshToken };
  }
}
