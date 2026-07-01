/**
 * EdKairos · item-generation · shared types
 * Mirrors the API spec + engine spec. GeneratedItem is a superset of the
 * Illuminate item format (standard, dok, distractor rationales) plus EdKairos
 * additions (figure spec, skill tags, micro-diagnostic, lifecycle).
 */
export type GenStatus = 'draft' | 'validated' | 'field_test' | 'operational' | 'rejected';

export type VersionType =
  | 'context_shift' | 'fraction' | 'decimal' | 'compound' | 'geo_probability'
  | 'psychology' | 'multi_step' | 'data_interpretation' | 'challenge' | 'misconception_trap';

export interface ItemOption {
  label?: string;
  text: string;
  correct: boolean;
  /** human rationale; required (non-empty) on every distractor */
  misconception?: string;
  /** canonical id from misconception-library.ts; required on every distractor */
  misconceptionTag: string;
}

export interface BaseItem {
  sourceId?: string;
  standard: string;            // MGSE legacy or current GA code
  ga?: string;
  gaCluster?: string;
  stem: string;
  options?: ItemOption[];
  answer?: string | number;
  dok?: 1 | 2 | 3 | 4;
  /** seed refers to/needs a table, graph, figure, or diagram — preserve it (CRA) */
  visual?: boolean;
  referenceOnly: boolean;      // ALWAYS true for ingested seed/purchased items
}

export interface GeneratedItem {
  versionType: VersionType;
  transformChain?: string[];
  stem: string;
  figure?: Record<string, unknown> | string | null;
  options: ItemOption[];
  answer: string | number;
  solution: string;
  standard: string;
  ga?: string;
  gaCluster?: string;
  skillTags: string[];
  skillNode?: string;
  misconceptionTags?: string[];
  dok: 1 | 2 | 3 | 4;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Challenge';
  microDiagnosticSignal: string;
  provenance: 'AIG';
}

export interface ValidationReport {
  passed: boolean;
  checks: { id: string; ok: boolean; detail?: string }[];
  regenerateHints?: string[];
}

export interface DraftItem extends GeneratedItem {
  id: string;
  batchId: string;
  status: GenStatus;
  validation?: ValidationReport;
  baseSourceId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  calibration?: { responses: number; pValue?: number; difFlag?: boolean };
}

export interface GenerateRequest {
  baseItems: BaseItem[];
  versionsPerItem?: number;          // 5..10, default 10
  versionTypes?: (VersionType | 'auto')[];
  options?: { calculatorDefault?: boolean; gradeBand?: string };
}
