import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const message =
      exception instanceof HttpException
        ? exception.message
        : 'Internal server error';

    // Log the CAUSE before discarding it. Without this, the client gets
    // {"message":"Internal server error"} and the server keeps no record at all —
    // pino-http reports only THAT the status was 500, never why. A silent 500 on the
    // diagnostic save cost four sessions of guessing in September 2026.
    // 4xx is the caller's problem and stays quiet; 5xx is ours and gets a stack.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const err = exception instanceof Error ? exception : undefined;
      const prisma = exception as { code?: unknown; meta?: unknown };
      this.logger.error(
        [
          `${request?.method ?? '?'} ${request?.url ?? '?'} -> ${status}`,
          err ? `${err.name}: ${err.message}` : `thrown: ${String(exception)}`,
          prisma?.code ? `code=${String(prisma.code)}` : '',
          prisma?.meta ? `meta=${JSON.stringify(prisma.meta)}` : '',
        ]
          .filter(Boolean)
          .join(' | '),
        err?.stack,
      );
    }

    response.status(status).json({
      success: false,
      error: { code: status.toString(), message },
    });
  }
}
