/**
 * Canonicalise the many nationality spellings that land in `players.nationality` from our
 * different sources (FBref uses 3-letter FIFA codes, Transfermarkt/API use full names, with
 * variant spellings and one mojibake). One canonical string per real nation so dedupe,
 * search and prompts treat "Ireland"/"Republic of Ireland" or "BFA"/"Burkina Faso" as one.
 *
 * Historical entities (Yugoslavia, Soviet Union, Czechoslovakia, East Germany, Serbia &
 * Montenegro) are kept DISTINCT on purpose — they aren't safely equatable to one modern
 * nation (a "YUG" player could be Croatian, Serbian, Bosnian…), so we never collapse them.
 */

// 3-letter FIFA/IOC codes → full nation name.
const CODE_MAP: Record<string, string> = {
  ANG: 'Angola', ARM: 'Armenia', ATG: 'Antigua and Barbuda', AZE: 'Azerbaijan',
  BDI: 'Burundi', BEN: 'Benin', BER: 'Bermuda', BFA: 'Burkina Faso', BLR: 'Belarus',
  BOL: 'Bolivia', BRB: 'Barbados', CAM: 'Cambodia', CAY: 'Cayman Islands', CGO: 'Congo',
  CHA: 'Chad', CHN: 'China PR', COM: 'Comoros', CPV: 'Cape Verde',
  CTA: 'Central African Republic', CUW: 'Curaçao', CYP: 'Cyprus', DOM: 'Dominican Republic',
  ECU: 'Ecuador', EQG: 'Equatorial Guinea', EST: 'Estonia', GAM: 'Gambia', GEO: 'Georgia',
  GLP: 'Guadeloupe', GNB: 'Guinea-Bissau', GRN: 'Grenada', GUF: 'French Guiana', GUY: 'Guyana',
  HAI: 'Haiti', HON: 'Honduras', IDN: 'Indonesia', IRQ: 'Iraq', ISR: 'Israel', JAM: 'Jamaica',
  KAZ: 'Kazakhstan', KEN: 'Kenya', KVX: 'Kosovo', LBR: 'Liberia', LBY: 'Libya', LIB: 'Lebanon',
  LIE: 'Liechtenstein', LTU: 'Lithuania', LUX: 'Luxembourg', LVA: 'Latvia', MAD: 'Madagascar',
  MAS: 'Malaysia', MCO: 'Monaco', MDA: 'Moldova', MLT: 'Malta', MNE: 'Montenegro',
  MOZ: 'Mozambique', MRI: 'Mauritius', MSR: 'Montserrat', MTN: 'Mauritania', MTQ: 'Martinique',
  MWI: 'Malawi', NAM: 'Namibia', NCL: 'New Caledonia', NIG: 'Niger', NZL: 'New Zealand',
  OMA: 'Oman', PAK: 'Pakistan', PAN: 'Panama', PAR: 'Paraguay', PER: 'Peru', PHI: 'Philippines',
  QAT: 'Qatar', REU: 'Réunion', SEY: 'Seychelles', SKN: 'St. Kitts and Nevis',
  SLE: 'Sierra Leone', SMN: 'San Marino', SMR: 'San Marino', SOM: 'Somalia', TJK: 'Tajikistan',
  TKM: 'Turkmenistan', TOG: 'Togo', TRI: 'Trinidad and Tobago', UZB: 'Uzbekistan',
  VEN: 'Venezuela', ZAM: 'Zambia', ZIM: 'Zimbabwe',
  // historical — kept distinct
  GDR: 'East Germany', URS: 'Soviet Union', CIS: 'CIS', YUG: 'Yugoslavia',
  SCG: 'Serbia and Montenegro', TCH: 'Czechoslovakia',
};

// Variant full-name spellings → canonical full name.
const ALIAS_MAP: Record<string, string> = {
  'Ireland': 'Republic of Ireland',
  'Ireland Republic': 'Republic of Ireland',
  'Ivory Coast': "Côte d'Ivoire",
  "CÃ´te d'Ivoire": "Côte d'Ivoire", // mojibake (UTF-8 read as Latin-1)
  'Czechia': 'Czech Republic',
  'Türkiye': 'Turkey',
  'Korea Republic': 'South Korea',
  'Korea DPR': 'North Korea',
  'DR Congo': 'Congo DR',
  'Cape Verde Islands': 'Cape Verde',
  'Réunion': 'Réunion',
  'Kingdom of the Netherlands': 'Netherlands',
  'The Netherlands': 'Netherlands',
};

export function canonicalNationality(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  const v = raw.trim();
  if (!v) return 'Unknown';
  // 3-letter codes are stored upper-case; match case-insensitively but only if it looks like a code.
  if (/^[A-Za-z]{3}$/.test(v) && CODE_MAP[v.toUpperCase()]) return CODE_MAP[v.toUpperCase()]!;
  if (ALIAS_MAP[v]) return ALIAS_MAP[v]!;
  return v;
}
