import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
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
    if (typeof body === 'string')
      return { status: error.getStatus(), message: body };
    const { message } = body as { message?: string | string[] };
    if (Array.isArray(message)) {
      return {
        status: error.getStatus(),
        message: 'Validation failed',
        details: message,
      };
    }
    return { status: error.getStatus(), message: message ?? error.message };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002')
      return { status: 409, message: 'Resource already exists' };
    if (error.code === 'P2025')
      return { status: 404, message: 'Resource not found' };
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
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }
}
