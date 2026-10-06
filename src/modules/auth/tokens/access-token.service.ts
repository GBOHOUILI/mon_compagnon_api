import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  Role,
  User,
  UserStatus,
} from '../../../generated/prisma/client.js';

export interface AccessClaims {
  sub: string;
  role: Role;
  status: UserStatus;
}

@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(user: Pick<User, 'id' | 'role' | 'status'>): Promise<string> {
    return this.jwt.signAsync(
      { role: user.role, status: user.status },
      { subject: user.id },
    );
  }

  verify(token: string): Promise<AccessClaims> {
    return this.jwt.verifyAsync<AccessClaims>(token);
  }
}
