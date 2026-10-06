import 'reflect-metadata';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgresql://moncompagnon:moncompagnon@localhost:5443/moncompagnon_test',
  FRONT_ORIGIN: 'http://localhost:3000',
  JWT_PRIVATE_KEY: privateKey
    .export({ format: 'pem', type: 'pkcs8' })
    .toString(),
  JWT_PUBLIC_KEY: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
});
