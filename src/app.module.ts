import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './core/config/env.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
})
export class AppModule {}
