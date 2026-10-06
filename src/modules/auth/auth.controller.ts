import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  type AuthUser,
  CurrentUser,
} from '../../core/common/auth/current-user.decorator.js';
import { Public } from '../../core/common/auth/public.decorator.js';
import type { Env } from '../../core/config/env.js';
import { UserResponseDto } from '../users/dto/user-response.dto.js';
import { UsersService } from '../users/users.service.js';
import {
  clearSessionCookies,
  REFRESH_COOKIE,
  setSessionCookies,
} from './auth.cookies.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const STRICT = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Throttle(STRICT)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.register(dto, req.get('user-agent'));
    setSessionCookies(res, session, this.config);
    return UserResponseDto.from(session.user);
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(dto, req.get('user-agent'));
    setSessionCookies(res, session, this.config);
    return UserResponseDto.from(session.user);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof raw !== 'string' || raw === '')
      throw new UnauthorizedException('No refresh token');
    const session = await this.auth.refresh(raw, req.get('user-agent'));
    setSessionCookies(res, session, this.config);
    return UserResponseDto.from(session.user);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw: unknown = req.cookies?.[REFRESH_COOKIE];
    await this.auth.logout(typeof raw === 'string' ? raw : undefined);
    clearSessionCookies(res, this.config);
  }

  @Get('me')
  async me(@CurrentUser() current: AuthUser) {
    const user = await this.users.findById(current.id);
    if (!user) throw new NotFoundException('User not found');
    return UserResponseDto.from(user);
  }
}
