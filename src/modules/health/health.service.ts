import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { PrismaService } from "../../prisma/prisma.service";

type DependencyStatus = "ok" | "error" | "unconfigured";

export interface HealthSnapshot {
  status: "ok" | "error";
  database: { status: "ok" | "error"; latencyMs: number };
  redis: { status: DependencyStatus; latencyMs: number };
  timestamp: string;
  version: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<HealthSnapshot> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    return {
      status:
        database.status === "ok" && redis.status !== "error" ? "ok" : "error",
      database,
      redis,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? "0.0.1",
    };
  }

  private async checkDatabase(): Promise<{
    status: "ok" | "error";
    latencyMs: number;
  }> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", latencyMs: Date.now() - started };
    } catch {
      return { status: "error", latencyMs: -1 };
    }
  }

  private async checkRedis(): Promise<{
    status: DependencyStatus;
    latencyMs: number;
  }> {
    const redisUrl = this.config.get<string>("redis.url")?.trim();
    if (!redisUrl) return { status: "unconfigured", latencyMs: -1 };

    const started = Date.now();
    let client: Redis | undefined;
    try {
      client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await client.connect();
      await client.ping();
      return { status: "ok", latencyMs: Date.now() - started };
    } catch {
      return { status: "error", latencyMs: -1 };
    } finally {
      client?.disconnect();
    }
  }
}
