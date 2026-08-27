/**
 * Deterministic, dependency-free PRNG.
 *
 * The prompt engine must produce the *same* brief for the same
 * (prompt, preset, seed) triple, otherwise `local-photo reproduce` is a lie.
 * But two images from the same request should not get an identical brief
 * either, or `--count 4` returns four near-duplicates. Seeding from the image
 * seed gives us both.
 */

/** FNV-1a, 32-bit. Stable across runs and platforms. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface Rng {
  next(): number;
  pick<T>(items: readonly T[]): T;
  /** Returns true with probability `p`. */
  chance(p: number): boolean;
  /** Picks `n` distinct items, preserving source order. */
  sample<T>(items: readonly T[], n: number): T[];
}

/** mulberry32 — small, fast, good enough for phrasing choices. */
export function createRng(seed: number | string): Rng {
  let state = (typeof seed === "string" ? hashString(seed) : seed >>> 0) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("pick() on empty list");
      return items[Math.floor(next() * items.length)]!;
    },
    chance(p: number): boolean {
      return next() < p;
    },
    sample<T>(items: readonly T[], n: number): T[] {
      if (n >= items.length) return [...items];
      const indices = items.map((_, i) => i);
      // Partial Fisher-Yates, then re-sort so output order matches input order.
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(next() * (indices.length - i));
        [indices[i], indices[j]] = [indices[j]!, indices[i]!];
      }
      return indices
        .slice(0, n)
        .sort((a, b) => a - b)
        .map((i) => items[i]!);
    },
  };
}
