import { Controller, Get } from "@nestjs/common";
import { Public } from "@common/decorators/public.decorator";
import { HealthService, HealthSnapshot } from "./health.service";

@Public()
@Controller("api/v1/health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(): Promise<{ success: true; data: HealthSnapshot }> {
    const data = await this.healthService.check();
    return {
      success: true,
      data,
    };
  }
}
