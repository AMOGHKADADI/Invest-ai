/**
 * Shared numeric optimiser utilities for the in-browser models (LSTM and DQN).
 * Float64 throughout so gradients can be verified with finite differences.
 */

/** Mulberry32 — small, fast, fully deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A flat parameter block with gradients and Adam moments. */
export class Param {
  readonly w: Float64Array;
  readonly g: Float64Array;
  readonly m: Float64Array;
  readonly v: Float64Array;

  constructor(
    readonly rows: number,
    readonly cols: number,
    init: 'xavier' | 'zeros',
    rand: () => number,
  ) {
    const size = rows * cols;
    this.w = new Float64Array(size);
    this.g = new Float64Array(size);
    this.m = new Float64Array(size);
    this.v = new Float64Array(size);
    if (init === 'xavier') {
      const limit = Math.sqrt(6 / (rows + cols));
      for (let i = 0; i < size; i++) this.w[i] = (rand() * 2 - 1) * limit;
    }
  }

  zeroGrad(): void {
    this.g.fill(0);
  }
}

export interface AdamState {
  b1: number;
  b2: number;
  eps: number;
  step: number;
}

export function createAdam(): AdamState {
  return { b1: 0.9, b2: 0.999, eps: 1e-8, step: 0 };
}

/** Adam step with bias correction; gradients are consumed (not zeroed) here. */
export function adamUpdate(params: Param[], lr: number, state: AdamState): void {
  state.step += 1;
  const bc1 = 1 - Math.pow(state.b1, state.step);
  const bc2 = 1 - Math.pow(state.b2, state.step);
  for (const p of params) {
    for (let i = 0; i < p.w.length; i++) {
      const grad = p.g[i];
      p.m[i] = state.b1 * p.m[i] + (1 - state.b1) * grad;
      p.v[i] = state.b2 * p.v[i] + (1 - state.b2) * grad * grad;
      const mHat = p.m[i] / bc1;
      const vHat = p.v[i] / bc2;
      p.w[i] -= (lr * mHat) / (Math.sqrt(vHat) + state.eps);
    }
  }
}

/** Global L2 gradient clipping, applied before the optimiser step. */
export function clipGradients(params: Param[], maxNorm: number): void {
  let total = 0;
  for (const p of params) for (let i = 0; i < p.g.length; i++) total += p.g[i] * p.g[i];
  const norm = Math.sqrt(total);
  if (norm <= maxNorm || norm === 0) return;
  const scale = maxNorm / norm;
  for (const p of params) for (let i = 0; i < p.g.length; i++) p.g[i] *= scale;
}
