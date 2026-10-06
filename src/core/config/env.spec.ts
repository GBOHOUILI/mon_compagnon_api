import { validateEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  FRONT_ORIGIN: 'http://localhost:3000',
  JWT_PRIVATE_KEY: 'private',
  JWT_PUBLIC_KEY: 'public',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
  });

  it('converts numeric strings', () => {
    expect(validateEnv({ ...valid, PORT: '4100' }).PORT).toBe(4100);
  });

  it('refuses a missing variable and names it', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('refuses an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });
});
