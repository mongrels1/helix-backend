import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { gateSlate, gateItem } from './reliability-gate';
import type { GeneratedItem, ValidationReport } from './types';

/**
 * Runs the reliability gate over a batch and persists results, flipping
 * draft -> validated when a slate passes. Pure rules live in reliability-gate.ts.
 */
@Injectable()
export class ValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async validateBatch(batchId: string): Promise<{ passed: number; failed: number }> {
    const drafts = await this.prisma.draftItem.findMany({ where: { batchId } });
    const slates = new Map<string, typeof drafts>();
    for (const d of drafts) {
      const key = d.baseSourceId ?? 'ungrouped';
      if (!slates.has(key)) slates.set(key, []);
      slates.get(key)!.push(d);
    }
    let passed = 0;
    let failed = 0;
    for (const [, items] of slates) {
      const report = gateSlate(items as unknown as GeneratedItem[]);
      for (const it of items) {
        const itemOk = gateItem(it as unknown as GeneratedItem).every((c) => c.ok);
        const ok = report.passed && itemOk;
        await this.prisma.draftItem.update({
          where: { id: it.id },
          data: { validation: report as unknown as object, status: ok ? 'validated' : 'draft' },
        });
        ok ? passed++ : failed++;
      }
    }
    return { passed, failed };
  }

  reportFor(items: GeneratedItem[]): ValidationReport {
    return gateSlate(items);
  }
}
