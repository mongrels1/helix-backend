import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SpeakDto } from './dto/speak.dto';
import { TtsService } from './tts.service';

/**
 * POST /api/v1/tts — returns spoken audio (audio/mpeg) for a short text.
 * Protected by the global JwtAuthGuard (any signed-in user). The API key lives
 * only on the server; the browser never sees it. On any failure the client
 * falls back to the free browser voice.
 */
@Controller('api/v1/tts')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  @Post()
  @HttpCode(200)
  async speak(@Body() dto: SpeakDto, @Res() res: Response): Promise<void> {
    const audio = await this.tts.synthesize(dto.text);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.length),
      'Cache-Control': 'private, max-age=86400',
    });
    res.send(audio);
  }
}
