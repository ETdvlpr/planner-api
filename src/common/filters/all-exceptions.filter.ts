import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const res = body as Record<string, unknown>;
        message =
          typeof res.message === 'string'
            ? res.message
            : Array.isArray(res.message)
              ? (res.message as string[]).join(', ')
              : message;
        code = typeof res.error === 'string' ? res.error : code;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, code, message } = mapPrismaError(exception));
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      code = 'BAD_REQUEST';
      message = 'Invalid data provided';
    } else if (exception instanceof Error) {
      // Never echo an internal message to the client; it is in the log.
      message = 'An unexpected error occurred';
    }

    this.logger.error(
      `${request.method} ${request.url} → ${status}: ${
        exception instanceof Error ? exception.message : message
      }`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json({
      success: false,
      data: null,
      error: { code, message },
    });
  }
}

/** Maps the Prisma error codes this API can actually produce. */
function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  status: number;
  code: string;
  message: string;
} {
  switch (error.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'A record with these values already exists',
      };
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'BAD_REQUEST',
        message: 'Referenced record does not exist',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'Record not found',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'DATABASE_ERROR',
        message: 'A database error occurred',
      };
  }
}
