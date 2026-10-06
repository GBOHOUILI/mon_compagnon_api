// Usage: pnpm keys:generate — creates an ES256 key pair for local JWTs in .env.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});
const oneLine = (key, type) =>
  key.export({ format: 'pem', type }).toString().trim().replace(/\n/g, '\\n');
const lines = {
  JWT_PRIVATE_KEY: `"${oneLine(privateKey, 'pkcs8')}"`,
  JWT_PUBLIC_KEY: `"${oneLine(publicKey, 'spki')}"`,
};
let env = readFileSync(existsSync('.env') ? '.env' : '.env.example', 'utf8');
for (const [name, value] of Object.entries(lines)) {
  const re = new RegExp(`^${name}=.*$`, 'm');
  env = re.test(env)
    ? env.replace(re, () => `${name}=${value}`)
    : `${env.trimEnd()}\n${name}=${value}\n`;
}
writeFileSync('.env', env);
console.log('JWT keys written to .env');
