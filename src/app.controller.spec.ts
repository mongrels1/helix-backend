import { Test, TestingModule } from "@nestjs/testing";
import { HealthController } from "./modules/health/health.controller";
import { HealthService } from "./modules/health/health.service";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            check: jest.fn().mockResolvedValue({
              status: "ok",
              database: { status: "ok", latencyMs: 1 },
              redis: { status: "unconfigured", latencyMs: -1 },
              timestamp: "2026-06-18T00:00:00.000Z",
              version: "0.0.1",
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it("returns an ok health response", async () => {
    await expect(controller.check()).resolves.toMatchObject({
      success: true,
      data: {
        status: "ok",
      },
    });
  });
});
