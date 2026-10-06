import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { toHttpError } from './all-exceptions.filter.js';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '7' });

describe('toHttpError', () => {
  it('keeps HttpException status and message', () => {
    expect(toHttpError(new NotFoundException('No user'))).toEqual({
      status: 404,
      message: 'No user',
    });
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
