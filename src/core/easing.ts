import type { Easing } from './types.ts';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Two-phase overshoot used by caption entrances: 0 -> overshoot -> 1. Matches the original ass_bounce.py. */
export function bounce(t: number, overshoot = 1.15, split = 0.6): number {
  t = clamp01(t);
  if (t <= split) {
    const x = t / split;
    return (1 - (1 - x) ** 3) * overshoot;
  }
  const x = (t - split) / (1 - split);
  return overshoot + (1 - overshoot) * (x * x * (3 - 2 * x));
}

export function ease(kind: Easing, t: number): number {
  t = clamp01(t);
  switch (kind) {
    case 'linear':
      return t;
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - (1 - t) ** 3;
    case 'inOut':
      return t * t * (3 - 2 * t);
    case 'hold':
      return 0;
    case 'bounce':
      return bounce(t);
  }
}
