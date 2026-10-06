import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'node:crypto';
import { AccessTokenService } from './access-token.service.js';

const keys = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return {
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
};

const make = (k = keys()) =>
  new AccessTokenService(
    new JwtService({
      ...k,
      signOptions: {
        algorithm: 'ES256',
        expiresIn: 900,
        issuer: 'mon-compagnon-api',
      },
      verifyOptions: { algorithms: ['ES256'], issuer: 'mon-compagnon-api' },
    }),
  );

describe('AccessTokenService', () => {
  const user = { id: 'u1', role: 'FAMILY', status: 'ACTIVE' } as const;

  it('round-trips the claims', async () => {
    const service = make();
    const claims = await service.verify(await service.sign(user));
    expect(claims).toMatchObject({
      sub: 'u1',
      role: 'FAMILY',
      status: 'ACTIVE',
    });
  });

  it('rejects a token signed with another key', async () => {
    const token = await make().sign(user);
    await expect(make().verify(token)).rejects.toThrow();
  });

  it('uses ES256', async () => {
    const [header] = (await make().sign(user)).split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString()).alg).toBe(
      'ES256',
    );
  });
});
