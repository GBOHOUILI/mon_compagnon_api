import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC } from '../../core/common/auth/public.decorator.js';
import { ROLES } from '../../core/common/auth/roles.decorator.js';
import type { Role } from '../../generated/prisma/client.js';
import { ACCESS_COOKIE } from './auth.cookies.js';
import { AccessTokenService } from './tokens/access-token.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets))
      return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const token: unknown = request.cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || token === '') {
      throw new UnauthorizedException('Not authenticated');
    }
    const claims = await this.accessTokens.verify(token).catch(() => {
      throw new UnauthorizedException('Invalid or expired session');
    });
    if (claims.status !== 'ACTIVE')
      throw new ForbiddenException('Account suspended');
    request.user = { id: claims.sub, role: claims.role };

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES,
      targets,
    );
    if (roles && !roles.includes(claims.role))
      throw new ForbiddenException('Forbidden');
    return true;
  }
}
