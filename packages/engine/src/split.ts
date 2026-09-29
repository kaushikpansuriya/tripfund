/**
 * Expense splitting.
 *
 * Every split returns integer shares (minor units) whose sum is EXACTLY the
 * expense amount. Rounding leftovers are handed out one minor unit at a time
 * with the largest-remainder method, ties broken by participant order, so the
 * result is deterministic.
 */
import { isValidAmount } from './money.ts';

export type SplitMethod = 'equal' | 'exact' | 'percentage' | 'shares';

export const SPLIT_METHODS: SplitMethod[] = ['equal', 'exact', 'percentage', 'shares'];

export interface SplitParticipant {
  memberId: string;
  /**
   * equal:      ignored
   * exact:      amount in minor units (integer ≥ 0)
   * percentage: percent, up to 2 decimals (e.g. 33.33)
   * shares:     number of shares, > 0, up to 2 decimals (e.g. 1.5)
   */
  value?: number | null;
}

export interface ShareResult {
  memberId: string;
  share: number;
}

export type SplitErrorCode =
  | 'INVALID_AMOUNT'
  | 'NO_PARTICIPANTS'
  | 'DUPLICATE_PARTICIPANT'
  | 'INVALID_METHOD'
  | 'INVALID_VALUE'
  | 'EXACT_SUM_MISMATCH'
  | 'PERCENT_SUM_MISMATCH'
  | 'ZERO_TOTAL_SHARES';

export class SplitError extends Error {
  code: SplitErrorCode;
  details: Record<string, unknown>;

  constructor(code: SplitErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SplitError';
    this.code = code;
    this.details = details;
  }
}

/** Convert a number with at most 2 decimals to an integer ×100, or null if it has more decimals. */
function toHundredths(value: number): bigint | null {
  if (!Number.isFinite(value)) return null;
  const scaled = Math.round(value * 100);
  if (Math.abs(scaled - value * 100) > 1e-6) return null;
  return BigInt(scaled);
}

/**
 * Split `amount` in proportion to integer `weights` using largest remainder.
 * Sum of the result always equals `amount`.
 */
export function allocate(amount: number, weights: bigint[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0n);
  if (total <= 0n) throw new SplitError('ZERO_TOTAL_SHARES', 'Total weight must be greater than zero.');
  const big = BigInt(amount);
  const base: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let allocated = 0n;
  weights.forEach((w, index) => {
    const product = big * w;
    const part = product / total;
    base.push(part);
    allocated += part;
    remainders.push({ index, remainder: product % total });
  });
  let leftover = big - allocated;
  remainders.sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const r of remainders) {
    if (leftover <= 0n) break;
    base[r.index] += 1n;
    leftover -= 1n;
  }
  return base.map((v) => Number(v));
}

export function computeShares(amount: number, method: SplitMethod, participants: SplitParticipant[]): ShareResult[] {
  if (!isValidAmount(amount)) {
    throw new SplitError('INVALID_AMOUNT', 'Amount must be a positive whole number of minor units.', { amount });
  }
  if (!SPLIT_METHODS.includes(method)) {
    throw new SplitError('INVALID_METHOD', `Unknown split method "${String(method)}".`);
  }
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new SplitError('NO_PARTICIPANTS', 'Select at least one member to share this expense.');
  }
  const seen = new Set<string>();
  for (const p of participants) {
    if (seen.has(p.memberId)) {
      throw new SplitError('DUPLICATE_PARTICIPANT', 'A member can only appear once in a split.', { memberId: p.memberId });
    }
    seen.add(p.memberId);
  }

  const ids = participants.map((p) => p.memberId);
  const pack = (shares: number[]): ShareResult[] => ids.map((memberId, i) => ({ memberId, share: shares[i] }));

  switch (method) {
    case 'equal':
      return pack(allocate(amount, participants.map(() => 1n)));

    case 'exact': {
      const values = participants.map((p) => {
        const v = p.value;
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
          throw new SplitError('INVALID_VALUE', 'Each exact amount must be zero or more.', { memberId: p.memberId, value: v });
        }
        return v;
      });
      const sum = values.reduce((a, b) => a + b, 0);
      if (sum !== amount) {
        throw new SplitError('EXACT_SUM_MISMATCH', 'The exact amounts must add up to the expense amount.', {
          expected: amount,
          actual: sum,
          difference: amount - sum,
        });
      }
      return pack(values);
    }

    case 'percentage': {
      const basisPoints = participants.map((p) => {
        const v = p.value;
        const bp = typeof v === 'number' && v >= 0 && v <= 100 ? toHundredths(v) : null;
        if (bp === null) {
          throw new SplitError('INVALID_VALUE', 'Each percentage must be between 0 and 100 with at most 2 decimals.', {
            memberId: p.memberId,
            value: v,
          });
        }
        return bp;
      });
      const total = basisPoints.reduce((a, b) => a + b, 0n);
      if (total !== 10000n) {
        throw new SplitError('PERCENT_SUM_MISMATCH', 'The percentages must add up to exactly 100%.', {
          expected: 100,
          actual: Number(total) / 100,
        });
      }
      return pack(allocate(amount, basisPoints));
    }

    case 'shares': {
      const weights = participants.map((p) => {
        const v = p.value;
        const w = typeof v === 'number' && v > 0 && v <= 1_000_000 ? toHundredths(v) : null;
        if (w === null || w <= 0n) {
          throw new SplitError('INVALID_VALUE', 'Each member needs more than 0 shares (at most 2 decimals).', {
            memberId: p.memberId,
            value: v,
          });
        }
        return w;
      });
      return pack(allocate(amount, weights));
    }
  }
}
