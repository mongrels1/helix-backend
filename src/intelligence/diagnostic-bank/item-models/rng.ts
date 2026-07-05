/**
 * Seeded deterministic PRNG (mulberry32). Given the same seed, produces the same
 * sequence — so a generated item is reproducible and variety is controlled. Seeds
 * are NEVER stored; they only drive one generation.
 */
export interface Rng {
  int(min: number, max: number): number; // inclusive both ends
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[];
  bool(): boolean;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(arr: readonly T[]): T => arr[int(0, arr.length - 1)];
  const shuffle = <T>(arr: T[]): T[] => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const bool = (): boolean => next() < 0.5;
  return { int, pick, shuffle, bool };
}
