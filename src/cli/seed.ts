import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';
import { AppModule } from '../app.module.js';
import { Role } from '../generated/prisma/client.js';
import { UsersService } from '../modules/users/users.service.js';

// Demo accounts mirroring the front's mock data. Idempotent.
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error'],
});
const users = app.get(UsersService);
const passwordHash = await argon2.hash(
  process.env.SEED_PASSWORD ?? 'MonCompagnon2026!',
  {
    type: argon2.argon2id,
  },
);
const people = [
  {
    email: 'nadege@moncompagnon.bj',
    firstName: 'Nadège',
    lastName: 'K.',
    role: Role.FAMILY,
  },
  {
    email: 'mme.adjovi@moncompagnon.bj',
    firstName: 'Mme',
    lastName: 'Adjovi',
    role: Role.SENIOR,
  },
  {
    email: 'julienne@moncompagnon.bj',
    firstName: 'Julienne',
    lastName: 'A.',
    role: Role.COMPANION,
  },
  {
    email: 'equipe@moncompagnon.bj',
    firstName: 'Équipe',
    lastName: 'Cotonou',
    role: Role.ADMIN,
  },
];
for (const person of people) await users.ensure({ ...person, passwordHash });
console.log(`Seeded ${people.length} demo accounts`);
await app.close();
