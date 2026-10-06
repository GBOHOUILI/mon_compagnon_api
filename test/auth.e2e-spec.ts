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
    ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .map((c) => [c.split('=')[0], c]),
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
    const reg = await agent
      .post('/api/v1/auth/register')
      .send(family)
      .expect(201);
    expect(reg.body).toMatchObject({
      email: 'nadege@example.com',
      role: 'FAMILY',
    });
    expect(reg.body).not.toHaveProperty('passwordHash');

    const cookies = cookieMap(reg);
    expect(cookies.mc_access).toMatch(/HttpOnly/);
    expect(cookies.mc_access).toMatch(/SameSite=Lax/);
    expect(cookies.mc_refresh).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookies.mc_refresh).not.toMatch(/Expires=/);

    await agent.get('/api/v1/auth/me').expect(200);
    const refreshed = await agent.post('/api/v1/auth/refresh').expect(200);
    expect(cookieMap(refreshed).mc_refresh).toBeDefined();
    await agent.post('/api/v1/auth/logout').expect(204);
    await agent.post('/api/v1/auth/refresh').expect(401);
  });

  it('remember me sets a 30-day refresh cookie', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(family)
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: ' NADEGE@example.com',
        password: family.password,
        remember: true,
      })
      .expect(200);
    expect(cookieMap(res).mc_refresh).toMatch(/Expires=/);
  });

  it('refuses registering as ADMIN or with unknown fields', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/v1/auth/register')
      .send({ ...family, role: 'ADMIN' })
      .expect(400);
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ ...family, isAdmin: true })
      .expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      message: 'Validation failed',
    });
  });

  it('refuses a duplicate email with 409', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/v1/auth/register')
      .send(family)
      .expect(201);
    await request(server)
      .post('/api/v1/auth/register')
      .send({ ...family, email: 'NADEGE@example.com' })
      .expect(409);
  });

  it('answers 401 with the standard body for a missing or garbled session', async () => {
    const server = app.getHttpServer();
    const none = await request(server).get('/api/v1/auth/me').expect(401);
    expect(none.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
    await request(server)
      .get('/api/v1/auth/me')
      .set('Cookie', 'mc_access=not.a.jwt')
      .expect(401);
  });

  it('forbids a non-admin from admin routes (403)', async () => {
    const agent = request.agent(app.getHttpServer());
    const reg = await agent
      .post('/api/v1/auth/register')
      .send(family)
      .expect(201);
    await agent.get(`/api/v1/users/${reg.body.id}`).expect(403);
  });

  it('blocks a suspended account at login', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(family)
      .expect(201);
    await app
      .get(PrismaService)
      .user.update({
        where: { email: family.email },
        data: { status: 'SUSPENDED' },
      });
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: family.email, password: family.password })
      .expect(403);
  });
});
