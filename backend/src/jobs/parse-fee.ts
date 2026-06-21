export function parseTransferFeeEurM(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!value || value === 'n/a' || value === 'loan' || value === 'free') return value === 'free' ? 0 : null;

  const match = value.match(/([\d.]+)\s*m/i) ?? value.match(/€?\s*([\d.]+)/i);
  if (!match?.[1]) return null;

  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

export function classifyTransferType(raw: string | null | undefined): string {
  if (!raw) return 'unknown';
  const value = raw.trim().toLowerCase();
  if (value === 'free') return 'free';
  if (value === 'loan') return 'loan';
  if (value.includes('m') || value.includes('€')) return 'permanent';
  return 'unknown';
}
