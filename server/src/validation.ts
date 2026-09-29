import { z } from 'zod';
import { CURRENCY_CODES, MAX_AMOUNT, SPLIT_METHODS } from '../../packages/engine/src/index.ts';

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'upi', 'credit_card', 'debit_card', 'other'] as const;

export const uuid = z.string().uuid('Invalid id');

/** Money in minor units (integer). */
export const amount = z
  .number({ invalid_type_error: 'Amount must be a number' })
  .int('Amount must be in minor units (whole number)')
  .positive('Amount must be greater than zero')
  .max(MAX_AMOUNT, 'Amount is too large');

const isRealDate = (value: string) => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(isRealDate, 'Invalid date');
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use HH:MM');

/**
 * Optional text: trims and limits length. "" or null → null (clear the field),
 * missing → undefined (leave unchanged on updates).
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email')
  .max(254);

const optionalEmail = z
  .union([email, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? v : null));

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const registerSchema = z.object({
  name: requiredText(100),
  email,
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

// ---------------------------------------------------------------------------
// Trips, members, categories
// ---------------------------------------------------------------------------
export const memberInputSchema = z.object({
  name: requiredText(100),
  email: optionalEmail,
});

const dateRange = <T extends { startDate?: string | null; endDate?: string | null }>(v: T) =>
  !v.startDate || !v.endDate || v.endDate >= v.startDate;

export const createTripSchema = z
  .object({
    name: requiredText(120),
    destination: optionalText(120),
    description: optionalText(2000),
    startDate: date.nullish(),
    endDate: date.nullish(),
    currency: z.enum(CURRENCY_CODES as [string, ...string[]]).default('INR'),
    /** Other members (the creator is added automatically as owner). */
    members: z.array(memberInputSchema).max(100).default([]),
  })
  .refine(dateRange, { message: 'End date must be on or after the start date', path: ['endDate'] });

export const updateTripSchema = z
  .object({
    name: requiredText(120).optional(),
    destination: optionalText(120),
    description: optionalText(2000),
    startDate: date.nullish(),
    endDate: date.nullish(),
    currency: z.enum(CURRENCY_CODES as [string, ...string[]]).optional(),
    fundHolderMemberId: uuid.nullish(),
    memberEditPolicy: z.enum(['own', 'none']).optional(),
  })
  .refine(dateRange, { message: 'End date must be on or after the start date', path: ['endDate'] });

export const updateMemberSchema = z
  .object({
    name: requiredText(100).optional(),
    email: optionalEmail,
    role: z.enum(['owner', 'member']).optional(),
    status: z.enum(['active', 'left']).optional(),
    joinedOn: date.nullish(),
    leftOn: date.nullish(),
  })
  .refine((v) => !v.joinedOn || !v.leftOn || v.leftOn >= v.joinedOn, { message: 'Left date must be after joined date', path: ['leftOn'] });

export const categorySchema = z.object({
  name: requiredText(50),
  icon: optionalText(16),
});

// ---------------------------------------------------------------------------
// Money records
// ---------------------------------------------------------------------------
const paymentMethod = z.enum(PAYMENT_METHODS);

export const contributionSchema = z.object({
  memberId: uuid,
  /** Who received / holds the money. Defaults to the trip's fund holder. */
  receivedByMemberId: uuid.nullish(),
  amount,
  date: date.optional(),
  paymentMethod: paymentMethod.default('cash'),
  notes: optionalText(1000),
});

export const participantSchema = z.object({
  memberId: uuid,
  value: z.number().finite().nullish(),
});

export const expenseSchema = z.object({
  kind: z.enum(['expense', 'refund']).default('expense'),
  title: requiredText(120),
  categoryId: uuid.nullish(),
  amount,
  paidByMemberId: uuid,
  splitMethod: z.enum(SPLIT_METHODS as [string, ...string[]]).transform((v) => v as (typeof SPLIT_METHODS)[number]),
  participants: z.array(participantSchema).min(1, 'Select at least one member').max(200),
  date: date.optional(),
  time: time.nullish(),
  location: optionalText(200),
  notes: optionalText(2000),
});

export const settlementSchema = z
  .object({
    fromMemberId: uuid,
    toMemberId: uuid,
    amount,
    date: date.optional(),
    paymentMethod: paymentMethod.default('cash'),
    note: optionalText(1000),
  })
  .refine((v) => v.fromMemberId !== v.toMemberId, { message: 'Sender and receiver must be different', path: ['toMemberId'] });

export const expenseFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  memberId: uuid.optional(),
  memberRole: z.enum(['any', 'paid', 'shared']).default('any'),
  categoryId: uuid.optional(),
  from: date.optional(),
  to: date.optional(),
  kind: z.enum(['expense', 'refund']).optional(),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('date_desc'),
});
