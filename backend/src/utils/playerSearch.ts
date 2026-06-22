export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** True when API returns a shortened display name like "H. Kane". */
export function isAbbreviatedName(name: string): boolean {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return /^[A-Za-z\u00C0-\u024F]\.?$/.test(first) || (first.length <= 2 && first.endsWith('.'));
}

export function buildPlayerSearchFields(
  apiName: string,
  firstname?: string | null,
  lastname?: string | null
): { name: string; aliases: string[]; searchText: string } {
  const first = firstname?.trim() ?? '';
  const last = lastname?.trim() ?? '';
  const fullName = first && last ? `${first} ${last}` : apiName.trim();

  const aliases = new Set<string>([apiName.trim(), fullName]);
  if (last) aliases.add(last);
  if (first) aliases.add(first);
  if (first && last) {
    aliases.add(`${first[0]}. ${last}`);
  }

  const parts = apiName.trim().split(/\s+/);
  if (parts.length > 1) {
    aliases.add(parts[parts.length - 1]!);
  }

  const searchText = [...aliases].map(normalizeSearchText).join(' ');

  return {
    name: first && last ? fullName : apiName.trim(),
    aliases: [...aliases],
    searchText,
  };
}
