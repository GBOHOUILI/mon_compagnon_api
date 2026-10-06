import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import type { Env } from '../../core/config/env.js';
import type { Session } from './auth.service.js';

export const ACCESS_COOKIE = 'mc_access';
export const REFRESH_COOKIE = 'mc_refresh';
const REFRESH_PATH = '/api/v1/auth';

function base(config: ConfigService<Env, true>): CookieOptions {
  return {
    httpOnly: true,
    secure: config.get('NODE_ENV', { infer: true }) === 'production',
    sameSite: 'lax',
    domain: config.get('COOKIE_DOMAIN', { infer: true }) || undefined,
  };
}

export function setSessionCookies(
  res: Response,
  session: Session,
  config: ConfigService<Env, true>,
) {
  const ttl = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  res.cookie(ACCESS_COOKIE, session.accessToken, {
    ...base(config),
    path: '/',
    maxAge: ttl * 1000,
  });
  res.cookie(REFRESH_COOKIE, session.refreshToken.token, {
    ...base(config),
    path: REFRESH_PATH,
    // Without "remember me" the cookie dies with the browser session.
    ...(session.refreshToken.persistent && {
      expires: session.refreshToken.expiresAt,
    }),
  });
}

export function clearSessionCookies(
  res: Response,
  config: ConfigService<Env, true>,
) {
  res.clearCookie(ACCESS_COOKIE, { ...base(config), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(config), path: REFRESH_PATH });
}
