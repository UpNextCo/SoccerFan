/**
 * Parse a raw transfer fee string (e.g. "€ 12.5M", "€ 995K", "$ 2M", "Free transfer",
 * "Loan") into a EUR value expressed in MILLIONS.
 *
 * The magnitude suffix is authoritative: "K"/"Th." are thousands (→ /1000), "M" is
 * millions, "bn" is billions (→ ×1000). A bare number with a currency symbol is treated
 * as an absolute euro amount. Getting this wrong previously inflated every "K" fee 1000×
 * (a "€ 995K" move showed as €995M), which corrupted the Draft/Bingo transfer-fee stats.
 */
export function parseTransferFeeEurM(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!value || value === 'n/a' || value === '-' || value === '?' || value === 'loan') return null;
  if (value === 'free' || value.includes('free transfer')) return 0;

  // Capture the first numeric amount and its (optional) magnitude suffix.
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(bn|m|k|th\.?)?/i);
  if (!match?.[1]) return null;

  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount)) return null;

  const unit = match[2]?.toLowerCase().replace('.', '');
  if (unit === 'bn') return amount * 1000;
  if (unit === 'm') return amount;
  if (unit === 'k' || unit === 'th') return amount / 1000;

  // No magnitude suffix: a large bare number is an absolute euro amount (→ millions);
  // a small one is already denominated in millions.
  return amount >= 1000 ? amount / 1_000_000 : amount;
}

export function classifyTransferType(raw: string | null | undefined): string {
  if (!raw) return 'unknown';
  const value = raw.trim().toLowerCase();
  if (value === 'free') return 'free';
  if (value === 'loan') return 'loan';
  if (value.includes('m') || value.includes('€')) return 'permanent';
  return 'unknown';
}
