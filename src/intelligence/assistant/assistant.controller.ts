import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { AssistantAnswer, AssistantService } from './assistant.service';
import { AskAssistantDto } from './dto/ask-assistant.dto';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 15;

@Controller('api/v1/assistant')
export class AssistantController {
  private readonly requests = new Map<string, number[]>();

  constructor(private readonly assistant: AssistantService) {}

  @Public()
  @Post('ask')
  async ask(
    @Body() dto: AskAssistantDto,
    @Ip() ip: string,
  ): Promise<AssistantAnswer> {
    const now = Date.now();
    const recent = (this.requests.get(ip) ?? []).filter(
      (timestamp) => now - timestamp < WINDOW_MS,
    );
    if (recent.length >= MAX_REQUESTS) {
      throw new HttpException(
        'Too many questions. Please try again in a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.requests.set(ip, recent);
    return this.assistant.ask(dto);
  }
}
