import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../../generated/prisma/client.js';

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
