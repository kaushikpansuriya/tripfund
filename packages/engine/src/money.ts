/**
 * Money helpers.
 *
 * All amounts inside the engine, the database and the API are integers in
 * the currency's minor unit (paise, cents, øre, fils). Floating point is only
 * used for display, never for calculation.
 */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  minorUnits: number;
  locale: string;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', minorUnits: 2, locale: 'en-IN' },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', minorUnits: 2, locale: 'en-US' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', minorUnits: 2, locale: 'en-IE' },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', minorUnits: 2, locale: 'en-GB' },
  DKK: { code: 'DKK', symbol: 'kr', name: 'Danish Krone', minorUnits: 2, locale: 'da-DK' },
  AED: { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', minorUnits: 2, locale: 'en-AE' },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES);

/** Largest amount accepted anywhere (in minor units): 10 trillion major units. */
export const MAX_AMOUNT = 1_000_000_000_000_000;

export function currencyInfo(code: string): CurrencyInfo {
  const info = CURRENCIES[code];
  if (!info) throw new Error(`Unsupported currency: ${code}`);
  return info;
}

/**
 * Parse a user-typed amount ("1,234.50", "1234", "1 234,5" is NOT accepted)
 * into integer minor units. Returns null for anything that is not a valid,
 * non-negative amount with at most `minorUnits` decimals.
 */
export function parseMoney(input: string | number, minorUnits = 2): number | null {
  const text = String(input).trim().replace(/[,\s_]/g, '');
  if (text === '') return null;
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const whole = match[1];
  const fraction = match[2] ?? '';
  if (fraction.length > minorUnits) return null;
  const minor = BigInt(whole) * 10n ** BigInt(minorUnits) + BigInt(fraction.padEnd(minorUnits, '0') || '0');
  if (minor > BigInt(MAX_AMOUNT)) return null;
  return Number(minor);
}

/** Integer minor units → plain decimal string for inputs, e.g. 123450 → "1234.50". */
export function toDecimalString(minor: number, minorUnits = 2): string {
  const negative = minor < 0;
  const abs = BigInt(Math.abs(minor));
  const factor = 10n ** BigInt(minorUnits);
  const whole = abs / factor;
  const fraction = (abs % factor).toString().padStart(minorUnits, '0');
  return `${negative ? '-' : ''}${whole}${minorUnits > 0 ? '.' + fraction : ''}`;
}

/** Display formatting, e.g. 123450 INR → "₹1,234.50". */
export function formatMoney(
  minor: number,
  currency: string,
  options: { signed?: boolean; hideZeroDecimals?: boolean } = {},
): string {
  const info = CURRENCIES[currency] ?? { code: currency, minorUnits: 2, locale: 'en-US' };
  const value = minor / 10 ** info.minorUnits;
  const wholeNumber = minor % 10 ** info.minorUnits === 0;
  const digits = options.hideZeroDecimals && wholeNumber ? 0 : info.minorUnits;
  const formatted = new Intl.NumberFormat(info.locale, {
    style: 'currency',
    currency: info.code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value));
  if (minor < 0) return `-${formatted}`;
  if (options.signed && minor > 0) return `+${formatted}`;
  return formatted;
}

export function isValidAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT;
}
