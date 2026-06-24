import { Controller, Get, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { register } from '../../common/middleware/metrics.middleware';

@Public()
@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(@Res() res: Response): Promise<void> {
    res.end(await register.metrics());
  }
}
