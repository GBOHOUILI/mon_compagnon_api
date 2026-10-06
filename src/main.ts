import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './core/bootstrap.js';
import type { Env } from './core/config/env.js';

const app = await NestFactory.create(AppModule);
configureApp(app);
await app.listen(
  app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true }),
);
