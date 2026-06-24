import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Counter, Histogram, collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics({ prefix: 'helix_' });

export const httpRequestDuration = new Histogram({
  name: 'helix_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
});

export const httpRequestTotal = new Counter({
  name: 'helix_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

export const httpErrorTotal = new Counter({
  name: 'helix_http_errors_total',
  help: 'Total HTTP 4xx and 5xx responses',
  labelNames: ['method', 'route', 'status_code'],
});

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const route = req.path.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+/gi,
      ':id',
    );

    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const labels = {
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };
      httpRequestDuration.observe(labels, duration);
      httpRequestTotal.inc(labels);
      if (res.statusCode >= 400) {
        httpErrorTotal.inc(labels);
      }
    });

    next();
  }
}

export { register };
