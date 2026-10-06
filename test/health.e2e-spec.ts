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
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('unknown routes answer with the standard error body', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: '/api/v1/nope',
    });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('serves the OpenAPI document', async () => {
    await request(app.getHttpServer()).get('/api/docs-json').expect(200);
  });
});
