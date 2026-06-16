import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { AIRouterService } from './ai-router.service';

@Controller('api/v1/ai')
export class AIRouterController {
  constructor(private readonly aiRouterService: AIRouterService) {}

  @Get('providers')
  @Roles(Role.SUPER_ADMIN, Role.ORG_ADMIN)
  getProviders(): {
    success: true;
    data: {
      providers: { name: 'openai' | 'gemini' | 'claude'; configured: boolean }[];
    };
  } {
    return {
      success: true,
      data: {
        providers: this.aiRouterService.getProviderConfigs(),
      },
    };
  }
}
