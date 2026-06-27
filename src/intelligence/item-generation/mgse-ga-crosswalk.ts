/**
 * EdKairos — MGSE -> GA standards crosswalk (+ figure routing)
 * Purchased/seed banks are coded in Georgia's LEGACY MGSE standards (2015).
 * EdKairos targets Georgia's CURRENT K-12 Mathematics Standards (Aug 2021).
 *   MGSE code -> GA expectation(s) -> GA cluster -> best figure type
 * The 6.NR.4 mapping is verified against Georgia-K-8-Mathematics-Standards.pdf.
 */

export type FigureType =
  | 'number_line' | 'fraction_bar' | 'rect' | 'bar_graph' | 'spinner'
  | 'triangle' | 'angle' | 'coordinate_grid' | 'dot_plot' | 'histogram'
  | 'place_value_chart' | 'decimal_grid' | 'function_table' | 'ratio_table'
  | 'geogebra' | 'geometry2d' | null;

export interface CrosswalkEntry {
  mgse: string;
  ga: string;
  gaCluster: string;
  title: string;
  figure: { primary: FigureType; alternates: FigureType[] };
  notes?: string;
}

export const CROSSWALK: CrosswalkEntry[] = [
  { mgse: 'MGSE6.RP.1',  ga: '6.NR.4.1', gaCluster: '6.NR.4',
    title: 'Explain the concept of a ratio; use ratio language for two quantities.',
    figure: { primary: 'ratio_table', alternates: ['number_line', 'bar_graph'] } },
  { mgse: 'MGSE6.RP.2',  ga: '6.NR.4.4', gaCluster: '6.NR.4',
    title: 'Describe rates and unit rate in the context of a ratio relationship.',
    figure: { primary: 'number_line', alternates: ['ratio_table', 'coordinate_grid'] } },
  { mgse: 'MGSE6.RP.3',  ga: '6.NR.4.3', gaCluster: '6.NR.4',
    title: 'Solve proportion problems using student-selected strategies (umbrella).',
    figure: { primary: 'ratio_table', alternates: ['number_line', 'coordinate_grid'] } },
  { mgse: 'MGSE6.RP.3a', ga: '6.NR.4.2', gaCluster: '6.NR.4',
    title: 'Tables of equivalent ratios; find missing values; plot pairs on the plane.',
    figure: { primary: 'ratio_table', alternates: ['coordinate_grid', 'number_line'] } },
  { mgse: 'MGSE6.RP.3b', ga: '6.NR.4.5', gaCluster: '6.NR.4',
    title: 'Solve unit rate problems including unit pricing and constant speed.',
    figure: { primary: 'number_line', alternates: ['ratio_table', 'coordinate_grid'] } },
  { mgse: 'MGSE6.RP.3c', ga: '6.NR.4.6', gaCluster: '6.NR.4',
    title: 'Percent of a quantity as a rate per 100; find whole given part and percent.',
    figure: { primary: 'fraction_bar', alternates: ['decimal_grid', 'ratio_table'] } },
  { mgse: 'MGSE6.RP.3d', ga: '6.NR.4.7', gaCluster: '6.NR.4',
    title: 'Use ratios to convert within/between measurement systems.',
    figure: { primary: 'ratio_table', alternates: ['number_line'] } },
];

export interface DomainScaffold { mgsePrefix: string; gaCluster: string; defaultFigure: FigureType; }
export const DOMAIN_SCAFFOLD: DomainScaffold[] = [
  { mgsePrefix: 'MGSE6.RP', gaCluster: '6.NR.4', defaultFigure: 'ratio_table' },
  { mgsePrefix: 'MGSE6.NS', gaCluster: '6.NR.1', defaultFigure: 'number_line' },
  { mgsePrefix: 'MGSE6.EE', gaCluster: '6.PAR.6', defaultFigure: 'rect' },
  { mgsePrefix: 'MGSE6.G',  gaCluster: '6.GSR.5', defaultFigure: 'geometry2d' },
  { mgsePrefix: 'MGSE6.SP', gaCluster: '6.DSR.7', defaultFigure: 'dot_plot' },
  { mgsePrefix: 'MGSE4.OA', gaCluster: '4.PAR.3', defaultFigure: 'function_table' },
  { mgsePrefix: 'MGSE4.NBT', gaCluster: '4.NR.1', defaultFigure: 'place_value_chart' },
  { mgsePrefix: 'MGSE4.NF', gaCluster: '4.NR.4', defaultFigure: 'fraction_bar' },
  { mgsePrefix: 'MGSE4.MD', gaCluster: '4.MDR.6', defaultFigure: 'bar_graph' },
  { mgsePrefix: 'MGSE4.G',  gaCluster: '4.GSR.8', defaultFigure: 'geometry2d' },
  { mgsePrefix: 'MGSE5.NBT', gaCluster: '5.NR.1', defaultFigure: 'place_value_chart' },
  { mgsePrefix: 'MGSE5.NF', gaCluster: '5.NR.3', defaultFigure: 'fraction_bar' },
  { mgsePrefix: 'MGSE5.MD', gaCluster: '5.MDR.7', defaultFigure: 'dot_plot' },
  { mgsePrefix: 'MGSE5.G',  gaCluster: '5.GSR.8', defaultFigure: 'coordinate_grid' },
  { mgsePrefix: 'MGSE7.RP', gaCluster: '7.PAR.4', defaultFigure: 'ratio_table' },
  { mgsePrefix: 'MGSE7.NS', gaCluster: '7.NR.1', defaultFigure: 'number_line' },
  { mgsePrefix: 'MGSE7.EE', gaCluster: '7.PAR.3', defaultFigure: 'rect' },
  { mgsePrefix: 'MGSE7.G',  gaCluster: '7.GSR.5', defaultFigure: 'geometry2d' },
  { mgsePrefix: 'MGSE7.SP', gaCluster: '7.PR.6', defaultFigure: 'spinner' },
  { mgsePrefix: 'MGSE8.NS', gaCluster: '8.NR.1', defaultFigure: 'number_line' },
  { mgsePrefix: 'MGSE8.EE', gaCluster: '8.PAR.4', defaultFigure: 'coordinate_grid' },
  { mgsePrefix: 'MGSE8.F',  gaCluster: '8.FGR.5', defaultFigure: 'function_table' },
  { mgsePrefix: 'MGSE8.G',  gaCluster: '8.GSR.8', defaultFigure: 'geometry2d' },
  { mgsePrefix: 'MGSE8.SP', gaCluster: '8.FGR.6', defaultFigure: 'coordinate_grid' },
];

function norm(code: string): string { return code.trim().toUpperCase().replace(/\s+/g, ''); }
const byMgse = new Map(CROSSWALK.map((e) => [norm(e.mgse), e]));
const byGa = new Map(CROSSWALK.map((e) => [norm(e.ga), e]));

export interface Resolved { input: string; ga: string; gaCluster: string; figure: FigureType; exact: boolean; }

export function resolveStandard(code: string): Resolved {
  const c = norm(code);
  if (!c.startsWith('MGSE')) {
    const m = c.match(/^(\d+\.[A-Z]+\.\d+)/);
    const cluster = m ? m[1] : c;
    const exactGa = byGa.get(c);
    const clusterRow = CROSSWALK.find((e) => e.gaCluster === cluster);
    const hit = exactGa ?? clusterRow;
    return { input: code, ga: c, gaCluster: cluster, figure: hit ? hit.figure.primary : null, exact: !!exactGa };
  }
  const exact = byMgse.get(c);
  if (exact) return { input: code, ga: exact.ga, gaCluster: exact.gaCluster, figure: exact.figure.primary, exact: true };
  const scaffold = DOMAIN_SCAFFOLD.filter((s) => c.startsWith(norm(s.mgsePrefix)))
    .sort((a, b) => b.mgsePrefix.length - a.mgsePrefix.length)[0];
  if (scaffold) return { input: code, ga: scaffold.gaCluster, gaCluster: scaffold.gaCluster, figure: scaffold.defaultFigure, exact: false };
  return { input: code, ga: c, gaCluster: c, figure: null, exact: false };
}

export function gaClusterOf(code: string): string { return resolveStandard(code).gaCluster; }
export function figureForStandard(code: string): FigureType { return resolveStandard(code).figure; }
export const MAPPED_MGSE: string[] = CROSSWALK.map((e) => e.mgse);
