import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  validateSync,
} from 'class-validator';

export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PORT = 4000;

  @IsString()
  DATABASE_URL: string;

  /** Origin allowed by CORS (the Next.js front). */
  @IsUrl({ require_tld: false })
  FRONT_ORIGIN: string;

  /** Parent domain shared with the front in production, e.g. `.moncompagnon.bj`. */
  @IsOptional()
  @IsString()
  COOKIE_DOMAIN?: string;

  /** ES256 PEM keys; newlines may be written as `\n`. */
  @IsString()
  JWT_PRIVATE_KEY: string;

  @IsString()
  JWT_PUBLIC_KEY: string;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  ACCESS_TOKEN_TTL_SECONDS = 900;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_DAYS = 30;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { enableImplicitConversion: true });
  const errors = validateSync(env);
  if (errors.length > 0) {
    const lines = errors.map(
      (e) =>
        ` - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    );
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return env;
}

/** Turns `\n` escapes from a one-line .env value back into a PEM. */
export const pem = (value: string) => value.replace(/\\n/g, '\n');
