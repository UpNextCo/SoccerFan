const subdivisionFlags: Record<string, string> = {
  england: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  scotland: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  wales: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
}

const countryISO: Record<string, string> = {
  france: 'fr', spain: 'es', germany: 'de', italy: 'it', portugal: 'pt',
  brazil: 'br', argentina: 'ar', netherlands: 'nl', holland: 'nl', belgium: 'be',
  croatia: 'hr', serbia: 'rs', uruguay: 'uy', colombia: 'co', mexico: 'mx',
  japan: 'jp', 'south korea': 'kr', 'korea republic': 'kr', 'north korea': 'kp',
  'korea dpr': 'kp', morocco: 'ma', nigeria: 'ng', ghana: 'gh', cameroon: 'cm',
  senegal: 'sn', 'ivory coast': 'ci', 'cote divoire': 'ci', 'cote d ivoire': 'ci',
  egypt: 'eg', algeria: 'dz', tunisia: 'tn', mali: 'ml', guinea: 'gn',
  'dr congo': 'cd', 'congo dr': 'cd', 'democratic republic of congo': 'cd', congo: 'cg',
  gabon: 'ga', 'burkina faso': 'bf', 'cape verde': 'cv', 'cabo verde': 'cv', angola: 'ao',
  zambia: 'zm', zimbabwe: 'zw', 'south africa': 'za', kenya: 'ke', uganda: 'ug',
  togo: 'tg', benin: 'bj', 'equatorial guinea': 'gq', 'guinea bissau': 'gw',
  'sierra leone': 'sl', liberia: 'lr', gambia: 'gm', mauritania: 'mr', madagascar: 'mg',
  mozambique: 'mz', comoros: 'km', libya: 'ly', sudan: 'sd', ethiopia: 'et',
  tanzania: 'tz', sweden: 'se', denmark: 'dk', norway: 'no', finland: 'fi',
  iceland: 'is', switzerland: 'ch', austria: 'at', poland: 'pl', 'czech republic': 'cz',
  czechia: 'cz', slovakia: 'sk', slovenia: 'si', hungary: 'hu', romania: 'ro',
  bulgaria: 'bg', ukraine: 'ua', russia: 'ru', turkey: 'tr', turkiye: 'tr',
  greece: 'gr', 'republic of ireland': 'ie', ireland: 'ie', 'northern ireland': 'gb',
  'united states': 'us', usa: 'us', 'united states of america': 'us', canada: 'ca',
  chile: 'cl', peru: 'pe', ecuador: 'ec', paraguay: 'py', bolivia: 'bo',
  venezuela: 've', australia: 'au', 'new zealand': 'nz', iran: 'ir', iraq: 'iq',
  'saudi arabia': 'sa', qatar: 'qa', 'united arab emirates': 'ae', uae: 'ae',
  china: 'cn', 'china pr': 'cn', israel: 'il', albania: 'al', 'north macedonia': 'mk',
  macedonia: 'mk', 'bosnia and herzegovina': 'ba', 'bosnia herzegovina': 'ba', bosnia: 'ba',
  montenegro: 'me', kosovo: 'xk', georgia: 'ge', armenia: 'am', azerbaijan: 'az',
  jamaica: 'jm', 'costa rica': 'cr', honduras: 'hn', panama: 'pa', 'el salvador': 'sv',
  guatemala: 'gt', 'trinidad and tobago': 'tt', suriname: 'sr', curacao: 'cw',
  haiti: 'ht', 'dominican republic': 'do', cuba: 'cu', nicaragua: 'ni',
  luxembourg: 'lu', malta: 'mt', cyprus: 'cy', estonia: 'ee', latvia: 'lv',
  lithuania: 'lt', belarus: 'by', moldova: 'md', 'faroe islands': 'fo', andorra: 'ad',
  'san marino': 'sm', liechtenstein: 'li', gibraltar: 'gi', kazakhstan: 'kz',
  india: 'in', indonesia: 'id', thailand: 'th', vietnam: 'vn', malaysia: 'my',
  singapore: 'sg', philippines: 'ph', uzbekistan: 'uz', syria: 'sy', lebanon: 'lb',
  jordan: 'jo', palestine: 'ps', kuwait: 'kw', bahrain: 'bh', oman: 'om', yemen: 'ye',
}

function normalizeCountry(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function flagEmoji(iso: string): string {
  return String.fromCodePoint(
    ...iso.toUpperCase().split('').map((character) => 0x1f1e6 + character.charCodeAt(0) - 65)
  )
}

/** Keep dashboard nationality display aligned with GuessWhoDisplay.nationalityFlag on iOS. */
export function nationalityFlag(nationality: string): string {
  const normalized = normalizeCountry(nationality)
  if (!normalized) return '🌐'
  return subdivisionFlags[normalized] ?? (countryISO[normalized] ? flagEmoji(countryISO[normalized]) : '🌐')
}
