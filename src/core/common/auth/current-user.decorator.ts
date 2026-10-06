import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '../../../generated/prisma/client.js';

export interface AuthUser {
  id: string;
  role: Role;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
