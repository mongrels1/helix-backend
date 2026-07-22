import { Injectable } from '@nestjs/common';
import { KSportsRepository } from './ksports.repository';
import { KSPORTS_MODULES, type KSportsModule } from './dto/record-fact.dto';

export interface KSportsProgress {
  owned: Record<KSportsModule, string[]>;
  counts: Record<KSportsModule, number>;
  total: number;
}

function emptyOwned(): Record<KSportsModule, string[]> {
  return { addsub: [], times: [], fracdec: [], formula: [] };
}

@Injectable()
export class KSportsService {
  constructor(private readonly repo: KSportsRepository) {}

  async getProgress(studentId: string): Promise<KSportsProgress> {
    const rows = await this.repo.findByStudent(studentId);
    const owned = emptyOwned();
    for (const r of rows) {
      const m = r.module as KSportsModule;
      if (KSPORTS_MODULES.includes(m)) owned[m].push(r.factKey);
    }
    const counts = Object.fromEntries(
      KSPORTS_MODULES.map((m) => [m, owned[m].length]),
    ) as Record<KSportsModule, number>;
    return { owned, counts, total: rows.length };
  }

  async recordFact(studentId: string, module: KSportsModule, factKey: string) {
    const added = await this.repo.record(studentId, module, factKey);
    const progress = await this.getProgress(studentId);
    return { added, total: progress.total, counts: progress.counts };
  }
}
