# API Foundation Implementation Plan


**Goal:** A NestJS + PostgreSQL API skeleton with users, cookie-based JWT
authentication (short access token + rotating refresh token), OpenAPI docs,
demo seed, tests and CI.

**Architecture:** Infrastructure lives in `src/core/` (config, Prisma,
errors, auth decorators); each feature is a folder in `src/modules/` with
controller / service / repository / module / dto. Only repositories touch
Prisma. A global guard protects every route unless marked `@Public()`.

**Tech Stack:** NestJS 12 (ESM scaffold), TypeScript strict, Prisma 7 +
`@prisma/adapter-pg`, PostgreSQL 17 (Docker), Vitest + supertest, oxlint +
Prettier, pnpm, Node 24.

**Spec:** `docs/specs/2026-10-06-api-foundation-design.md`

## Global Constraints

- Feature modules in `src/modules/<feature>/`; infrastructure in `src/core/`.
- Controller = HTTP only; service = business rules; repository = only Prisma
  user; DTOs validated with class-validator; output DTOs never expose
  `passwordHash`.
- Prefix `/api/v1`; error body
  `{ statusCode, error, message, details?, path, timestamp }`; Prisma P2002 → 409.
- Cookies httpOnly, `Secure` in production, `SameSite=Lax`, domain from
  `COOKIE_DOMAIN`; `mc_access` JWT ES256 15 min (claims `sub`, `role`,
  `status`); `mc_refresh` opaque, `path=/api/v1/auth`, 30 days if remember,
  else session cookie; stored hashed, rotated on use, reuse revokes the family.
- Register: roles `FAMILY` | `SENIOR` | `COMPANION` only; password ≥ 8 chars;
  login failure message generic; suspended account cannot log in or refresh.
- Dependencies limited to the spec list plus the Prisma 7 requirements below.
- ESM: relative imports end in `.js` (scaffold convention).
- Comments in English, only for non-obvious decisions. Git branches
  `feature/` `fix/` `chore/` `docs/`, merge `--no-ff`, atomic commits.

## Rulings carried from exploration (2026-10-06)

- Spec said NestJS 11 / Jest / ESLint; current `nest new` gives **NestJS 12,
  ESM, Vitest, oxlint**. Follow the scaffold. Cost if wrong: swap the test
  runner later.
- Prisma 7 **requires** a driver adapter: add `@prisma/adapter-pg` (pulls
  `pg`) and `dotenv` (dev, for `prisma.config.ts`). Pin `prisma` and
  `@prisma/client` to `^7` (the `latest` CLI tag resolved to an 8.0 RC).
- `RefreshToken.persistent` added (not in spec): needed to keep "remember me"
  across rotations.
- Non-persistent refresh tokens expire after 1 day in the database (the
  cookie itself ends with the browser session).
- A refresh token reused **within 10 s of its rotation** is rejected (401)
  without revoking the family: two tabs refreshing at once must not log the
  user out. Reuse after 10 s revokes the family.

## Review Focus

- Email typed with capitals or spaces (`" Nadege.K@Example.com "`) at login
  or register must match the stored lowercase address — Task 3 test.
- Two tabs refreshing simultaneously must not log the user out — Task 4 test
  (grace window).
- A missing, malformed or expired `mc_access` must answer 401 with the
  standard error body, never 500 — Task 5 e2e.
- A request trying to register with `role: "ADMIN"` or extra fields must be
  rejected with 400 — Task 5 e2e.
- Login timing must not reveal whether the email exists (hash verified
  against a dummy hash when the user is unknown) — Task 5 unit test.

---

### Task 1: Scaffold, Docker, validated configuration

**Files:**
- Create (via `nest new`): `package.json`, `tsconfig*.json`, `nest-cli.json`,
  `vitest.config*.ts`, `.oxlintrc.json`, `.prettierrc`, `src/main.ts`,
  `src/app.module.ts`
- Delete: `src/app.controller*.ts`, `src/app.service.ts`, `test/app.e2e-spec.ts`
- Create: `docker-compose.yml`, `.env.example`, `.gitignore`,
  `src/core/config/env.ts`, `src/core/config/env.spec.ts`,
  `scripts/generate-keys.mjs`, `README.md`

**Produces:** `Env` class and `validateEnv(raw)`; `ConfigModule` global;
scripts `typecheck`, `keys:generate`; DBs on `localhost:5433` (dev) and
`localhost:5434` (test).

- [ ] **Step 1: scaffold into the repo** (it already holds `docs/`)

```bash
cd "/home/eldo/Projects/Zero To One/mon compagnon/Mon Compagnon API"
git switch -c chore/scaffold
pnpm dlx @nestjs/cli@latest new . --package-manager pnpm --skip-git --strict
rm src/app.controller.ts src/app.controller.spec.ts src/app.service.ts test/app.e2e-spec.ts
pnpm add @nestjs/config class-validator class-transformer
```

Set `"name": "mon-compagnon-api"`, add scripts
`"typecheck": "tsc --noEmit"`, `"keys:generate": "node scripts/generate-keys.mjs"`.

- [ ] **Step 2: write the failing test** `src/core/config/env.spec.ts`

```ts
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
    expect(() => validateEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
```

- [ ] **Step 3: run** `pnpm test src/core/config` → FAIL (module not found).

- [ ] **Step 4: implement** `src/core/config/env.ts`

```ts
import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUrl, Min, validateSync } from 'class-validator';

export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

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

  @IsInt()
  @Min(60)
  ACCESS_TOKEN_TTL_SECONDS = 900;

  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_DAYS = 30;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { enableImplicitConversion: true });
  const errors = validateSync(env);
  if (errors.length > 0) {
    const lines = errors.map(
      (e) => ` - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    );
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return env;
}

/** Turns `\n` escapes from a one-line .env value back into a PEM. */
export const pem = (value: string) => value.replace(/\\n/g, '\n');
```

- [ ] **Step 5: run** `pnpm test src/core/config` → PASS (4).

- [ ] **Step 6: wire config, Docker, keys script, env example**

`src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './core/config/env.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
})
export class AppModule {}
```

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: moncompagnon
      POSTGRES_PASSWORD: moncompagnon
      POSTGRES_DB: moncompagnon
    ports: ['5433:5432']
    volumes: ['db-data:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U moncompagnon']
      interval: 2s
      retries: 15
  db-test:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: moncompagnon
      POSTGRES_PASSWORD: moncompagnon
      POSTGRES_DB: moncompagnon_test
    ports: ['5434:5432']
    tmpfs: ['/var/lib/postgresql/data']
volumes:
  db-data: {}
```

`scripts/generate-keys.mjs` (writes or replaces the two keys in `.env`):

```js
// Usage: pnpm keys:generate — creates an ES256 key pair for local JWTs in .env.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const oneLine = (key, type) => key.export({ format: 'pem', type }).toString().trim().replace(/\n/g, '\\n');
const lines = {
  JWT_PRIVATE_KEY: `"${oneLine(privateKey, 'pkcs8')}"`,
  JWT_PUBLIC_KEY: `"${oneLine(publicKey, 'spki')}"`,
};
let env = existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8');
for (const [name, value] of Object.entries(lines)) {
  const re = new RegExp(`^${name}=.*$`, 'm');
  env = re.test(env) ? env.replace(re, `${name}=${value}`) : `${env.trimEnd()}\n${name}=${value}\n`;
}
writeFileSync('.env', env);
console.log('JWT keys written to .env');
```

`.env.example`:

```
NODE_ENV=development
PORT=4000
DATABASE_URL="postgresql://moncompagnon:moncompagnon@localhost:5433/moncompagnon"
FRONT_ORIGIN=http://localhost:3000
# Production only, shared with the front: .moncompagnon.bj
COOKIE_DOMAIN=
# Run `pnpm keys:generate` to fill these two.
JWT_PRIVATE_KEY=
JWT_PUBLIC_KEY=
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
# Password of the demo accounts created by `pnpm db:seed`.
SEED_PASSWORD=MonCompagnon2026!
```

`.gitignore` adds: `.env`, `src/generated/`. Files that `prisma init`
drops for editor tooling are deleted, not committed.

- [ ] **Step 7: verify boot**

```bash
docker compose up -d && pnpm keys:generate && pnpm build && timeout 5 node dist/main.js; echo $?
```

Expected: app starts (exit 124 from timeout). With `.env` moved away it
exits with "Invalid environment" listing the variables.

- [ ] **Step 8: commit** `chore: scaffold the NestJS API with validated config and Docker databases`

### Task 2: Prisma, error format, bootstrap, health

**Files:**
- Create: `prisma.config.ts`, `prisma/schema.prisma`,
  `src/core/prisma/prisma.service.ts`, `src/core/prisma/prisma.module.ts`,
  `src/core/common/all-exceptions.filter.ts`,
  `src/core/common/all-exceptions.filter.spec.ts`, `src/core/bootstrap.ts`,
  `src/modules/health/health.controller.ts`,
  `src/modules/health/health.module.ts`, `test/setup-e2e.ts`,
  `test/global-setup-e2e.ts`, `test/app.ts`, `test/health.e2e-spec.ts`
- Modify: `src/main.ts`, `src/app.module.ts`, `vitest.config.e2e.ts`

**Interfaces — Produces:** `PrismaService` (extends generated
`PrismaClient`); `AllExceptionsFilter`, `toHttpError(e)`;
`configureApp(app: INestApplication): void`; e2e helpers
`createTestApp(): Promise<INestApplication>` and
`resetDatabase(app): Promise<void>`.

- [ ] **Step 1: install and init Prisma**

```bash
pnpm add @prisma/client@^7 @prisma/adapter-pg @nestjs/swagger helmet cookie-parser
pnpm add -D prisma@^7 dotenv @types/cookie-parser
pnpm exec prisma init --datasource-provider postgresql
mv prisma*.config.ts prisma.config.ts && rm -f .env.bak
```

`prisma/schema.prisma` generator block:

```prisma
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "esm"
  importFileExtension = "js"
}

datasource db {
  provider = "postgresql"
}
```

Add scripts: `"postinstall": "prisma generate"`,
`"db:migrate": "prisma migrate dev"`, `"db:deploy": "prisma migrate deploy"`.

- [ ] **Step 2: failing unit test** `src/core/common/all-exceptions.filter.spec.ts`

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { toHttpError } from './all-exceptions.filter.js';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '7' });

describe('toHttpError', () => {
  it('keeps HttpException status and message', () => {
    expect(toHttpError(new NotFoundException('No user'))).toEqual({ status: 404, message: 'No user' });
  });
  it('turns validation messages into details', () => {
    const e = new BadRequestException({ message: ['email must be an email'] });
    expect(toHttpError(e)).toEqual({
      status: 400,
      message: 'Validation failed',
      details: ['email must be an email'],
    });
  });
  it('maps a unique constraint violation to 409', () => {
    expect(toHttpError(known('P2002')).status).toBe(409);
  });
  it('maps a missing record to 404', () => {
    expect(toHttpError(known('P2025')).status).toBe(404);
  });
  it('hides unknown errors behind a 500', () => {
    expect(toHttpError(new Error('db password is x'))).toEqual({
      status: 500,
      message: 'Internal server error',
    });
  });
});
```

- [ ] **Step 3: run** `pnpm prisma generate && pnpm test src/core/common` → FAIL.

- [ ] **Step 4: implement the filter** `src/core/common/all-exceptions.filter.ts`

```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { Prisma } from '../../generated/prisma/client.js';

export interface HttpError {
  status: number;
  message: string;
  details?: unknown;
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'string') return { status: error.getStatus(), message: body };
    const { message } = body as { message?: string | string[] };
    if (Array.isArray(message)) {
      return { status: error.getStatus(), message: 'Validation failed', details: message };
    }
    return { status: error.getStatus(), message: message ?? error.message };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return { status: 409, message: 'Resource already exists' };
    if (error.code === 'P2025') return { status: 404, message: 'Resource not found' };
  }
  return { status: 500, message: 'Internal server error' };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { status, message, details } = toHttpError(exception);
    if (status >= 500) this.logger.error(exception);
    response.status(status).json({
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      message,
      ...(details !== undefined && { details }),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 5: run** → PASS (5).

- [ ] **Step 6: failing e2e** `test/health.e2e-spec.ts` plus helpers

`test/setup-e2e.ts` (per test file; keys generated once per run):

```ts
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgresql://moncompagnon:moncompagnon@localhost:5434/moncompagnon_test',
  FRONT_ORIGIN: 'http://localhost:3000',
  JWT_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  JWT_PUBLIC_KEY: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
});
```

`test/global-setup-e2e.ts`:

```ts
import { execSync } from 'node:child_process';

export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://moncompagnon:moncompagnon@localhost:5434/moncompagnon_test';
  execSync('pnpm exec prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
```

`test/app.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/core/bootstrap.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Empties every table between tests (order-independent thanks to CASCADE). */
export async function resetDatabase(app: INestApplication) {
  const prisma = app.get(PrismaService);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}
```

`vitest.config.e2e.ts` test block gains
`setupFiles: ['./test/setup-e2e.ts'], globalSetup: ['./test/global-setup-e2e.ts'], fileParallelism: false`.

`test/health.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app.js';

describe('health and errors (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('GET /api/v1/health reports the database', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('unknown routes answer with the standard error body', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found', path: '/api/v1/nope' });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('serves the OpenAPI document', async () => {
    await request(app.getHttpServer()).get('/api/docs-json').expect(200);
  });
});
```

- [ ] **Step 7: run** `docker compose up -d && pnpm test:e2e` → FAIL (missing modules).

- [ ] **Step 8: implement Prisma, bootstrap, health**

`prisma.config.ts` (from init) keeps `import 'dotenv/config'`.

`src/core/prisma/prisma.service.ts`:

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { Env } from '../config/env.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL', { infer: true }) }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

`src/core/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

`src/core/bootstrap.ts`:

```ts
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import type { Env } from './config/env.js';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export function configureApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.setGlobalPrefix('api/v1');
  // The API only serves JSON (and the Swagger page): a CSP would only break Swagger UI.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableCors({ origin: config.get('FRONT_ORIGIN', { infer: true }), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Mon Compagnon API').setVersion('1').addCookieAuth('mc_access').build(),
  );
  SwaggerModule.setup('api/docs', app, document);
}
```

`src/main.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './core/bootstrap.js';
import type { Env } from './core/config/env.js';

const app = await NestFactory.create(AppModule);
configureApp(app);
await app.listen(app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true }));
```

`src/modules/health/health.controller.ts`:

```ts
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma/prisma.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
    return { status: 'ok', database: 'up' };
  }
}
```

(`@Public()` is added in Task 5 when the global guard exists.)

`src/modules/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`src/app.module.ts` imports `PrismaModule` and `HealthModule`.

Create the first (empty-model) migration so `migrate deploy` works:
`pnpm exec prisma migrate dev --name init` (against the dev DB).

- [ ] **Step 9: run** `pnpm test && pnpm test:e2e` → PASS (unit 9, e2e 3).

- [ ] **Step 10: commit** `feat: add Prisma, the error format, the app bootstrap and a health check`

### Task 3: Users (schema, repository, service, admin read)

**Files:**
- Modify: `prisma/schema.prisma` (+ migration `users_and_refresh_tokens`)
- Create: `src/modules/users/users.repository.ts`,
  `src/modules/users/users.service.ts`, `src/modules/users/users.service.spec.ts`,
  `src/modules/users/users.controller.ts`, `src/modules/users/users.module.ts`,
  `src/modules/users/dto/user-response.dto.ts`

**Interfaces — Produces:** `UsersService.create(input: NewUser): Promise<User>`,
`findByEmail(email): Promise<User | null>`, `findById(id): Promise<User | null>`,
`normalizeEmail(email): string`; `UserResponseDto.from(user)`; types
`Role`, `UserStatus`, `User` from `src/generated/prisma/client.js`.

- [ ] **Step 1: schema**

```prisma
enum Role {
  FAMILY
  SENIOR
  COMPANION
  ADMIN
}

enum UserStatus {
  ACTIVE
  SUSPENDED
}

model User {
  id            String         @id @default(uuid()) @db.Uuid
  email         String         @unique
  phone         String?
  firstName     String         @map("first_name")
  lastName      String         @map("last_name")
  role          Role
  status        UserStatus     @default(ACTIVE)
  passwordHash  String         @map("password_hash")
  createdAt     DateTime       @default(now()) @map("created_at")
  updatedAt     DateTime       @updatedAt @map("updated_at")
  refreshTokens RefreshToken[]

  @@map("users")
}

model RefreshToken {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique @map("token_hash")
  familyId   String    @map("family_id") @db.Uuid
  persistent Boolean   @default(false)
  expiresAt  DateTime  @map("expires_at")
  revokedAt  DateTime? @map("revoked_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  userAgent  String?   @map("user_agent")

  @@index([familyId])
  @@map("refresh_tokens")
}
```

Run `pnpm exec prisma migrate dev --name users_and_refresh_tokens`.

- [ ] **Step 2: failing test** `src/modules/users/users.service.spec.ts`

```ts
import { ConflictException } from '@nestjs/common';
import { Role, type User } from '../../generated/prisma/client.js';
import type { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

function fakeRepository(existing: User[] = []) {
  const users = [...existing];
  return {
    users,
    findByEmail: vi.fn(async (email: string) => users.find((u) => u.email === email) ?? null),
    findById: vi.fn(async (id: string) => users.find((u) => u.id === id) ?? null),
    create: vi.fn(async (data: Omit<User, 'id' | 'status' | 'createdAt' | 'updatedAt'>) => {
      const user = { ...data, id: `id-${users.length}`, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() } as User;
      users.push(user);
      return user;
    }),
  };
}

const input = {
  email: ' Nadege.K@Example.com ',
  firstName: 'Nadège',
  lastName: 'K.',
  role: Role.FAMILY,
  passwordHash: 'hash',
};

describe('UsersService', () => {
  it('stores the email trimmed and lowercased', async () => {
    const repo = fakeRepository();
    const service = new UsersService(repo as unknown as UsersRepository);
    const user = await service.create(input);
    expect(user.email).toBe('nadege.k@example.com');
  });

  it('refuses an email already registered, whatever its case', async () => {
    const repo = fakeRepository();
    const service = new UsersService(repo as unknown as UsersRepository);
    await service.create(input);
    await expect(service.create({ ...input, email: 'NADEGE.K@example.com' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('finds a user by email typed with capitals and spaces', async () => {
    const repo = fakeRepository();
    const service = new UsersService(repo as unknown as UsersRepository);
    await service.create(input);
    expect(await service.findByEmail('  NADEGE.K@EXAMPLE.COM')).not.toBeNull();
  });
});
```

- [ ] **Step 3: run** `pnpm prisma generate && pnpm test src/modules/users` → FAIL.

- [ ] **Step 4: implement**

`users.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { Prisma, User } from '../../generated/prisma/client.js';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  upsertByEmail(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.upsert({ where: { email: data.email }, update: {}, create: data });
  }
}
```

`users.service.ts`:

```ts
import { ConflictException, Injectable } from '@nestjs/common';
import type { Role, User } from '../../generated/prisma/client.js';
import { UsersRepository } from './users.repository.js';

export interface NewUser {
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  role: Role;
  passwordHash: string;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  findById(id: string) {
    return this.users.findById(id);
  }

  findByEmail(email: string) {
    return this.users.findByEmail(normalizeEmail(email));
  }

  async create(input: NewUser): Promise<User> {
    const email = normalizeEmail(input.email);
    if (await this.users.findByEmail(email)) {
      throw new ConflictException('Email already registered');
    }
    return this.users.create({ ...input, email });
  }

  /** Seed only: creates the user once, leaves an existing one untouched. */
  ensure(input: NewUser): Promise<User> {
    return this.users.upsertByEmail({ ...input, email: normalizeEmail(input.email) });
  }
}
```

`dto/user-response.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Role, type User, UserStatus } from '../../../generated/prisma/client.js';

/** Public view of a user: never exposes the password hash. */
export class UserResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty({ required: false, nullable: true }) phone: string | null;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty({ enum: UserStatus }) status: UserStatus;
  @ApiProperty() createdAt: Date;

  static from(user: User): UserResponseDto {
    const { id, email, phone, firstName, lastName, role, status, createdAt } = user;
    return Object.assign(new UserResponseDto(), { id, email, phone, firstName, lastName, role, status, createdAt });
  }
}
```

`users.controller.ts` (admin read; guards arrive in Task 5):

```ts
import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserResponseDto } from './dto/user-response.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return UserResponseDto.from(user);
  }
}
```

`users.module.ts` provides `UsersRepository`, `UsersService`, exports
`UsersService`, declares `UsersController`; `AppModule` imports it.

- [ ] **Step 5: run** `pnpm test` → PASS.
- [ ] **Step 6: commit** `feat: add users with normalised emails`

### Task 4: Tokens (access JWT, rotating refresh token)

**Files:**
- Create: `src/modules/auth/tokens/access-token.service.ts`,
  `src/modules/auth/tokens/refresh-token.repository.ts`,
  `src/modules/auth/tokens/refresh-token.service.ts`,
  `src/modules/auth/tokens/refresh-token.service.spec.ts`,
  `src/modules/auth/tokens/access-token.service.spec.ts`

**Interfaces — Produces:**
- `AccessTokenService.sign(user: Pick<User, 'id' | 'role' | 'status'>): Promise<string>`;
  `verify(token: string): Promise<AccessClaims>` with
  `AccessClaims = { sub: string; role: Role; status: UserStatus }`.
- `RefreshTokenService.issue(userId, { persistent, userAgent?, familyId? }): Promise<IssuedRefreshToken>`;
  `rotate(raw, userAgent?): Promise<{ userId: string; token: IssuedRefreshToken }>`;
  `revokeFamilyOf(raw): Promise<void>`; `IssuedRefreshToken = { token: string; expiresAt: Date; persistent: boolean }`.
- Constant `REUSE_GRACE_MS = 10_000`.

- [ ] **Step 1: failing tests**

`access-token.service.spec.ts`:

```ts
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'node:crypto';
import { AccessTokenService } from './access-token.service.js';

const keys = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
};
const make = (k = keys()) =>
  new AccessTokenService(
    new JwtService({
      ...k,
      signOptions: { algorithm: 'ES256', expiresIn: 900, issuer: 'mon-compagnon-api' },
      verifyOptions: { algorithms: ['ES256'], issuer: 'mon-compagnon-api' },
    }),
  );

describe('AccessTokenService', () => {
  const user = { id: 'u1', role: 'FAMILY', status: 'ACTIVE' } as const;

  it('round-trips the claims', async () => {
    const service = make();
    const claims = await service.verify(await service.sign(user));
    expect(claims).toMatchObject({ sub: 'u1', role: 'FAMILY', status: 'ACTIVE' });
  });

  it('rejects a token signed with another key', async () => {
    const token = await make().sign(user);
    await expect(make().verify(token)).rejects.toThrow();
  });

  it('uses ES256', async () => {
    const [header] = (await make().sign(user)).split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString()).alg).toBe('ES256');
  });
});
```

`refresh-token.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import type { RefreshToken } from '../../../generated/prisma/client.js';
import type { RefreshTokenRepository } from './refresh-token.repository.js';
import { REUSE_GRACE_MS, RefreshTokenService } from './refresh-token.service.js';

function fakeRepository() {
  const rows: RefreshToken[] = [];
  return {
    rows,
    create: vi.fn(async (data: Omit<RefreshToken, 'id' | 'createdAt' | 'revokedAt'>) => {
      const row = { ...data, id: `t${rows.length}`, createdAt: new Date(), revokedAt: null } as RefreshToken;
      rows.push(row);
      return row;
    }),
    findByHash: vi.fn(async (hash: string) => rows.find((r) => r.tokenHash === hash) ?? null),
    revokeIfActive: vi.fn(async (id: string, at: Date) => {
      const row = rows.find((r) => r.id === id && r.revokedAt === null);
      if (!row) return false;
      row.revokedAt = at;
      return true;
    }),
    revokeFamily: vi.fn(async (familyId: string, at: Date) => {
      rows.filter((r) => r.familyId === familyId && !r.revokedAt).forEach((r) => (r.revokedAt = at));
    }),
  };
}
const config = { get: () => 30 };
const make = (repo = fakeRepository()) => ({
  repo,
  service: new RefreshTokenService(repo as unknown as RefreshTokenRepository, config as never),
});

describe('RefreshTokenService', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-06T10:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('stores only a hash of the token', async () => {
    const { repo, service } = make();
    const issued = await service.issue('u1', { persistent: true });
    expect(repo.rows[0].tokenHash).not.toBe(issued.token);
    expect(issued.token.length).toBeGreaterThanOrEqual(43);
  });

  it('lasts 30 days when persistent, 1 day otherwise', async () => {
    const { service } = make();
    const day = 24 * 3600_000;
    expect((await service.issue('u1', { persistent: true })).expiresAt.getTime() - Date.now()).toBe(30 * day);
    expect((await service.issue('u1', { persistent: false })).expiresAt.getTime() - Date.now()).toBe(day);
  });

  it('rotates: the old token is revoked, the new one keeps family and persistence', async () => {
    const { repo, service } = make();
    const first = await service.issue('u1', { persistent: true });
    const { userId, token } = await service.rotate(first.token);
    expect(userId).toBe('u1');
    expect(token.persistent).toBe(true);
    expect(repo.rows[0].revokedAt).not.toBeNull();
    expect(repo.rows[1].familyId).toBe(repo.rows[0].familyId);
  });

  it('rejects an unknown token', async () => {
    await expect(make().service.rotate('nope')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const { service } = make();
    const t = await service.issue('u1', { persistent: false });
    vi.advanceTimersByTime(24 * 3600_000 + 1);
    await expect(service.rotate(t.token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('within the grace window, a reused token is refused but the family survives', async () => {
    const { repo, service } = make();
    const first = await service.issue('u1', { persistent: true });
    await service.rotate(first.token);
    vi.advanceTimersByTime(REUSE_GRACE_MS - 1);
    await expect(service.rotate(first.token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.rows[1].revokedAt).toBeNull();
  });

  it('after the grace window, reuse revokes the whole family', async () => {
    const { repo, service } = make();
    const first = await service.issue('u1', { persistent: true });
    await service.rotate(first.token);
    vi.advanceTimersByTime(REUSE_GRACE_MS + 1);
    await expect(service.rotate(first.token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.rows[1].revokedAt).not.toBeNull();
  });

  it('two concurrent rotations of the same token: only one succeeds', async () => {
    const { service } = make();
    const first = await service.issue('u1', { persistent: true });
    const results = await Promise.allSettled([service.rotate(first.token), service.rotate(first.token)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: run** `pnpm test src/modules/auth` → FAIL.

- [ ] **Step 3: implement**

`access-token.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role, User, UserStatus } from '../../../generated/prisma/client.js';

export interface AccessClaims {
  sub: string;
  role: Role;
  status: UserStatus;
}

@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(user: Pick<User, 'id' | 'role' | 'status'>): Promise<string> {
    return this.jwt.signAsync({ role: user.role, status: user.status }, { subject: user.id });
  }

  verify(token: string): Promise<AccessClaims> {
    return this.jwt.verifyAsync<AccessClaims>(token);
  }
}
```

`refresh-token.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import type { Prisma, RefreshToken } from '../../../generated/prisma/client.js';

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.RefreshTokenUncheckedCreateInput): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({ data });
  }

  findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  /** Atomic: true only for the caller that actually revoked it. */
  async revokeIfActive(id: string, at: Date): Promise<boolean> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
    return count === 1;
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: at } });
  }
}
```

`refresh-token.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../../../core/config/env.js';
import { RefreshTokenRepository } from './refresh-token.repository.js';

/** Two tabs refreshing at once reuse a token for a few seconds: not theft. */
export const REUSE_GRACE_MS = 10_000;
const DAY_MS = 24 * 3600_000;

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
  persistent: boolean;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly tokens: RefreshTokenRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(
    userId: string,
    options: { persistent: boolean; userAgent?: string; familyId?: string },
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const days = options.persistent ? this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) : 1;
    const expiresAt = new Date(Date.now() + days * DAY_MS);
    await this.tokens.create({
      userId,
      tokenHash: hash(token),
      familyId: options.familyId ?? randomUUID(),
      persistent: options.persistent,
      expiresAt,
      userAgent: options.userAgent?.slice(0, 255),
    });
    return { token, expiresAt, persistent: options.persistent };
  }

  async rotate(raw: string, userAgent?: string): Promise<{ userId: string; token: IssuedRefreshToken }> {
    const now = new Date();
    const row = await this.tokens.findByHash(hash(raw));
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    if (row.revokedAt) {
      if (now.getTime() - row.revokedAt.getTime() > REUSE_GRACE_MS) {
        await this.tokens.revokeFamily(row.familyId, now);
      }
      throw new UnauthorizedException('Refresh token already used');
    }
    if (row.expiresAt <= now) throw new UnauthorizedException('Refresh token expired');
    if (!(await this.tokens.revokeIfActive(row.id, now))) {
      throw new UnauthorizedException('Refresh token already used');
    }
    const token = await this.issue(row.userId, {
      persistent: row.persistent,
      userAgent,
      familyId: row.familyId,
    });
    return { userId: row.userId, token };
  }

  async revokeFamilyOf(raw: string): Promise<void> {
    const row = await this.tokens.findByHash(hash(raw));
    if (row) await this.tokens.revokeFamily(row.familyId, new Date());
  }
}
```

- [ ] **Step 4: run** `pnpm add @nestjs/jwt && pnpm test src/modules/auth` → PASS (11).
- [ ] **Step 5: commit** `feat: add access and rotating refresh tokens`

### Task 5: Auth flow, global guard, throttling

**Files:**
- Create: `src/core/common/auth/public.decorator.ts`,
  `src/core/common/auth/roles.decorator.ts`,
  `src/core/common/auth/current-user.decorator.ts`,
  `src/modules/auth/auth.guard.ts`, `src/modules/auth/auth.cookies.ts`,
  `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.service.spec.ts`,
  `src/modules/auth/auth.controller.ts`, `src/modules/auth/auth.module.ts`,
  `src/modules/auth/dto/register.dto.ts`, `src/modules/auth/dto/login.dto.ts`,
  `test/auth.e2e-spec.ts`
- Modify: `src/app.module.ts`, `src/modules/health/health.controller.ts`
  (`@Public()`), `src/modules/users/users.controller.ts` (`@Roles(Role.ADMIN)`)

**Interfaces — Consumes:** Tasks 3–4. **Produces:** `@Public()`,
`@Roles(...roles)`, `@CurrentUser()` → `AuthUser = { id: string; role: Role }`;
`AuthService.register/login/refresh/logout`; cookie names `mc_access`,
`mc_refresh`.

- [ ] **Step 1: failing unit test** `auth.service.spec.ts`

```ts
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Role, type User } from '../../generated/prisma/client.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { AccessTokenService } from './tokens/access-token.service.js';
import type { RefreshTokenService } from './tokens/refresh-token.service.js';

async function setup(status: User['status'] = 'ACTIVE') {
  const user = {
    id: 'u1',
    email: 'julienne@example.com',
    role: Role.COMPANION,
    status,
    passwordHash: await argon2.hash('correct horse', { type: argon2.argon2id }),
  } as User;
  const users = {
    findByEmail: vi.fn(async (e: string) => (e.trim().toLowerCase() === user.email ? user : null)),
    findById: vi.fn(async () => user),
    create: vi.fn(async (input: Partial<User>) => ({ ...user, ...input })),
  };
  const access = { sign: vi.fn(async () => 'access') };
  const refresh = {
    issue: vi.fn(async () => ({ token: 'r', expiresAt: new Date(), persistent: false })),
    rotate: vi.fn(async () => ({ userId: 'u1', token: { token: 'r2', expiresAt: new Date(), persistent: true } })),
    revokeFamilyOf: vi.fn(async () => undefined),
  };
  const verify = vi.spyOn(argon2, 'verify');
  const service = new AuthService(
    users as unknown as UsersService,
    access as unknown as AccessTokenService,
    refresh as unknown as RefreshTokenService,
  );
  return { service, users, refresh, verify };
}

describe('AuthService', () => {
  it('hashes the password with argon2id on register', async () => {
    const { service, users } = await setup();
    await service.register({ email: 'a@b.c', password: '12345678', firstName: 'A', lastName: 'B', role: Role.FAMILY });
    const { passwordHash } = users.create.mock.calls[0][0] as { passwordHash: string };
    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('logs in with the right password, whatever the email case', async () => {
    const { service } = await setup();
    const session = await service.login({ email: ' JULIENNE@example.com', password: 'correct horse' });
    expect(session.accessToken).toBe('access');
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const { service } = await setup();
    const a = service.login({ email: 'julienne@example.com', password: 'wrong' });
    const b = service.login({ email: 'ghost@example.com', password: 'wrong' });
    await expect(a).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    await expect(b).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
  });

  it('still verifies a hash when the email is unknown (no timing leak)', async () => {
    const { service, verify } = await setup();
    verify.mockClear();
    await service.login({ email: 'ghost@example.com', password: 'x' }).catch(() => undefined);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('refuses a suspended account at login and at refresh', async () => {
    const { service, refresh } = await setup('SUSPENDED');
    await expect(service.login({ email: 'julienne@example.com', password: 'correct horse' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.refresh('r')).rejects.toBeInstanceOf(ForbiddenException);
    expect(refresh.revokeFamilyOf).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: run** `pnpm add argon2 @nestjs/throttler && pnpm test src/modules/auth` → FAIL.

Add to `package.json`: `"pnpm": { "onlyBuiltDependencies": ["argon2", "@prisma/engines", "prisma"] }`
then `pnpm install` (argon2 needs its install script).

- [ ] **Step 3: implement decorators, DTOs, service, cookies, guard, controller, module**

`src/core/common/auth/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Opens a route to anonymous visitors (every route is protected by default). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

`roles.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../../generated/prisma/client.js';

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
```

`current-user.decorator.ts`:

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '../../../generated/prisma/client.js';

export interface AuthUser {
  id: string;
  role: Role;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
```

`dto/register.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../../generated/prisma/client.js';

export const SELF_SERVICE_ROLES = [Role.FAMILY, Role.SENIOR, Role.COMPANION] as const;

export class RegisterDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) password: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) firstName: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) lastName: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiProperty({ enum: SELF_SERVICE_ROLES }) @IsIn(SELF_SERVICE_ROLES) role: (typeof SELF_SERVICE_ROLES)[number];
}
```

`dto/login.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password: string;
  @ApiProperty({ required: false, description: 'Keep the session for 30 days' })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
```

`auth.service.ts`:

```ts
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { User } from '../../generated/prisma/client.js';
import { UsersService } from '../users/users.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { AccessTokenService } from './tokens/access-token.service.js';
import { type IssuedRefreshToken, RefreshTokenService } from './tokens/refresh-token.service.js';

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
    const valid = await argon2.verify(user?.passwordHash ?? (await DUMMY_HASH), dto.password);
    if (!user || !valid) throw new UnauthorizedException(INVALID);
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account suspended');
    return this.openSession(user, dto.remember ?? false, userAgent);
  }

  async refresh(raw: string, userAgent?: string): Promise<Session> {
    const { userId, token } = await this.refreshTokens.rotate(raw, userAgent);
    const user = await this.users.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.refreshTokens.revokeFamilyOf(token.token);
      throw new ForbiddenException('Account suspended');
    }
    return { user, accessToken: await this.accessTokens.sign(user), refreshToken: token };
  }

  async logout(raw: string | undefined): Promise<void> {
    if (raw) await this.refreshTokens.revokeFamilyOf(raw);
  }

  private async openSession(user: User, persistent: boolean, userAgent?: string): Promise<Session> {
    const [accessToken, refreshToken] = await Promise.all([
      this.accessTokens.sign(user),
      this.refreshTokens.issue(user.id, { persistent, userAgent }),
    ]);
    return { user, accessToken, refreshToken };
  }
}
```

`auth.cookies.ts`:

```ts
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

export function setSessionCookies(res: Response, session: Session, config: ConfigService<Env, true>) {
  const ttl = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  res.cookie(ACCESS_COOKIE, session.accessToken, { ...base(config), path: '/', maxAge: ttl * 1000 });
  res.cookie(REFRESH_COOKIE, session.refreshToken.token, {
    ...base(config),
    path: REFRESH_PATH,
    // Without "remember me" the cookie dies with the browser session.
    ...(session.refreshToken.persistent && { expires: session.refreshToken.expiresAt }),
  });
}

export function clearSessionCookies(res: Response, config: ConfigService<Env, true>) {
  res.clearCookie(ACCESS_COOKIE, { ...base(config), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(config), path: REFRESH_PATH });
}
```

`auth.guard.ts`:

```ts
import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
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
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = request.cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || token === '') throw new UnauthorizedException('Not authenticated');
    const claims = await this.accessTokens.verify(token).catch(() => {
      throw new UnauthorizedException('Invalid or expired session');
    });
    if (claims.status !== 'ACTIVE') throw new ForbiddenException('Account suspended');
    request.user = { id: claims.sub, role: claims.role };

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(claims.role)) throw new ForbiddenException('Forbidden');
    return true;
  }
}
```

`auth.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, NotFoundException, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { type AuthUser, CurrentUser } from '../../core/common/auth/current-user.decorator.js';
import { Public } from '../../core/common/auth/public.decorator.js';
import type { Env } from '../../core/config/env.js';
import { UserResponseDto } from '../users/dto/user-response.dto.js';
import { UsersService } from '../users/users.service.js';
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './auth.cookies.js';
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
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.register(dto, req.get('user-agent'));
    setSessionCookies(res, session, this.config);
    return UserResponseDto.from(session.user);
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(dto, req.get('user-agent'));
    setSessionCookies(res, session, this.config);
    return UserResponseDto.from(session.user);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (typeof raw !== 'string' || raw === '') throw new UnauthorizedException('No refresh token');
    const session = await this.auth.refresh(raw, req.get('user-agent'));
    setSessionCookies(res, session, this.config);
    return UserResponseDto.from(session.user);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearSessionCookies(res, this.config);
  }

  @Get('me')
  async me(@CurrentUser() current: AuthUser) {
    const user = await this.users.findById(current.id);
    if (!user) throw new NotFoundException('User not found');
    return UserResponseDto.from(user);
  }
}
```

`auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { pem, type Env } from '../../core/config/env.js';
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
        signOptions: { algorithm: 'ES256', expiresIn: config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }), issuer: ISSUER },
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
```

`app.module.ts` adds `AuthModule` and throttling (registered before
`AuthModule` so it runs first):

```ts
ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    throttlers: [{ ttl: 60_000, limit: 100 }],
    // The e2e suite logs in many times a minute.
    skipIf: () => config.get('NODE_ENV', { infer: true }) === 'test',
  }),
}),
// providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
```

`health.controller.ts`: add `@Public()` on the class. `users.controller.ts`:
add `@Roles(Role.ADMIN)` on `findOne`.

- [ ] **Step 4: run** `pnpm test` → PASS.

- [ ] **Step 5: failing e2e** `test/auth.e2e-spec.ts`

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { createTestApp, resetDatabase } from './app.js';

const family = {
  email: 'nadege@example.com',
  password: 'motdepasse',
  firstName: 'Nadège',
  lastName: 'K.',
  role: 'FAMILY',
};
const cookieMap = (res: request.Response) =>
  Object.fromEntries(
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => [c.split('=')[0], c]),
  );

describe('auth (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => resetDatabase(app));
  afterAll(() => app.close());

  it('register → me → refresh → logout', async () => {
    const agent = request.agent(app.getHttpServer());
    const reg = await agent.post('/api/v1/auth/register').send(family).expect(201);
    expect(reg.body).toMatchObject({ email: 'nadege@example.com', role: 'FAMILY' });
    expect(reg.body).not.toHaveProperty('passwordHash');

    const cookies = cookieMap(reg);
    expect(cookies.mc_access).toMatch(/HttpOnly/);
    expect(cookies.mc_access).toMatch(/SameSite=Lax/);
    expect(cookies.mc_refresh).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookies.mc_refresh).not.toMatch(/Expires=/); // no "remember me"

    await agent.get('/api/v1/auth/me').expect(200);
    const refreshed = await agent.post('/api/v1/auth/refresh').expect(200);
    expect(cookieMap(refreshed).mc_refresh).toBeDefined();
    await agent.post('/api/v1/auth/logout').expect(204);
    await agent.post('/api/v1/auth/refresh').expect(401);
  });

  it('remember me sets a 30-day refresh cookie', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(family).expect(201);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ' NADEGE@example.com', password: family.password, remember: true })
      .expect(200);
    expect(cookieMap(res).mc_refresh).toMatch(/Expires=/);
  });

  it('refuses registering as ADMIN or with unknown fields', async () => {
    const server = app.getHttpServer();
    await request(server).post('/api/v1/auth/register').send({ ...family, role: 'ADMIN' }).expect(400);
    const res = await request(server).post('/api/v1/auth/register').send({ ...family, isAdmin: true }).expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
  });

  it('refuses a duplicate email with 409', async () => {
    const server = app.getHttpServer();
    await request(server).post('/api/v1/auth/register').send(family).expect(201);
    await request(server).post('/api/v1/auth/register').send({ ...family, email: 'NADEGE@example.com' }).expect(409);
  });

  it('answers 401 with the standard body for a missing or garbled session', async () => {
    const server = app.getHttpServer();
    const none = await request(server).get('/api/v1/auth/me').expect(401);
    expect(none.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
    await request(server).get('/api/v1/auth/me').set('Cookie', 'mc_access=not.a.jwt').expect(401);
  });

  it('forbids a non-admin from admin routes (403)', async () => {
    const agent = request.agent(app.getHttpServer());
    const reg = await agent.post('/api/v1/auth/register').send(family).expect(201);
    await agent.get(`/api/v1/users/${reg.body.id}`).expect(403);
  });

  it('blocks a suspended account at login', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(family).expect(201);
    await app.get(PrismaService).user.update({ where: { email: family.email }, data: { status: 'SUSPENDED' } });
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: family.email, password: family.password })
      .expect(403);
  });
});
```

- [ ] **Step 6: run** `pnpm test:e2e` → PASS (health 3 + auth 7).
- [ ] **Step 7: commit** (two commits: guards/decorators + auth flow)
      `feat: protect every route by default with role checks` and
      `feat: add register, login, refresh, logout and me`

### Task 6: Seed, README, CI

**Files:**
- Create: `src/cli/seed.ts`, `.github/workflows/ci.yml`
- Modify: `README.md`, `package.json` (`"db:seed": "nest build && node dist/cli/seed.js"`)

- [ ] **Step 1: seed** `src/cli/seed.ts`

```ts
import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';
import { AppModule } from '../app.module.js';
import { Role } from '../generated/prisma/client.js';
import { UsersService } from '../modules/users/users.service.js';

// Demo accounts mirroring the front's mock data. Idempotent.
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const users = app.get(UsersService);
const passwordHash = await argon2.hash(process.env.SEED_PASSWORD ?? 'MonCompagnon2026!', { type: argon2.argon2id });
const people = [
  { email: 'nadege@moncompagnon.bj', firstName: 'Nadège', lastName: 'K.', role: Role.FAMILY },
  { email: 'mme.adjovi@moncompagnon.bj', firstName: 'Mme', lastName: 'Adjovi', role: Role.SENIOR },
  { email: 'julienne@moncompagnon.bj', firstName: 'Julienne', lastName: 'A.', role: Role.COMPANION },
  { email: 'equipe@moncompagnon.bj', firstName: 'Équipe', lastName: 'Cotonou', role: Role.ADMIN },
];
for (const person of people) await users.ensure({ ...person, passwordHash });
console.log(`Seeded ${people.length} demo accounts`);
await app.close();
```

Verify: `pnpm db:seed` twice → second run still 4 users
(`SELECT count(*) FROM users`).

- [ ] **Step 2: CI** `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: moncompagnon
          POSTGRES_PASSWORD: moncompagnon
          POSTGRES_DB: moncompagnon_test
        ports: ['5434:5432']
        options: >-
          --health-cmd "pg_isready -U moncompagnon" --health-interval 2s --health-retries 15
    env:
      TEST_DATABASE_URL: postgresql://moncompagnon:moncompagnon@localhost:5434/moncompagnon_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm test:e2e
```

- [ ] **Step 3: README** — sections: prérequis, démarrage
  (`docker compose up -d`, `cp .env.example .env`, `pnpm keys:generate`,
  `pnpm db:migrate`, `pnpm db:seed`, `pnpm start:dev`), comptes de démo et
  mot de passe, commandes, structure (`core/` vs `modules/`, convention
  controller/service/repository/module/dto), authentification (cookies,
  durées, rotation, clé publique pour le middleware Next), docs `/api/docs`.

- [ ] **Step 4: full gate** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`.

- [ ] **Step 5: commit** `chore: add demo seed, README and CI`, merge.
