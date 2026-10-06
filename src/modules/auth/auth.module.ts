import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { type Env, pem } from '../../core/config/env.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AccessTokenService } from './tokens/access-token.service.js';
import { RefreshTokenRepository } from './tokens/refresh-token.repository.js';
import { RefreshTokenService } from './tokens/refresh-token.service.js';

const ISSUER = 'mon-compagnon-api';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        privateKey: pem(config.get('JWT_PRIVATE_KEY', { infer: true })),
        publicKey: pem(config.get('JWT_PUBLIC_KEY', { infer: true })),
        signOptions: {
          algorithm: 'ES256',
          expiresIn: config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
          issuer: ISSUER,
        },
        verifyOptions: { algorithms: ['ES256'], issuer: ISSUER },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenService,
    RefreshTokenService,
    RefreshTokenRepository,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
