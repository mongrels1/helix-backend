import { Controller, Get } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';

@Public()
@Controller('api/v1/health')
export class HealthController {
  @Get()
  check(): object {
    return {
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version ?? '0.0.1',
      },
    };
  }
}
