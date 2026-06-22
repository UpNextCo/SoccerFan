const INITIAL_ALIAS_RE = /^([A-Za-z\u00C0-\u024F])\.\s*(\S+)\s*$/;

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

function isInitialToken(part: string): boolean {
  return /^[A-Za-z\u00C0-\u024F]\.?$/.test(part.trim());
}

function givenNameParts(apiName: string, firstname: string, lastname: string): string[] {
  const last = lastname.trim();
  const apiParts = apiName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => part.toLowerCase() !== last.toLowerCase())
    .filter((part) => !isInitialToken(part));

  const parts = [...firstname.trim().split(/\s+/).filter(Boolean), ...apiParts]
    .filter((part) => !isInitialToken(part));
  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
      unique.push(part);
    }
  }
  return unique;
}

/** Pick a fan-friendly display name like "Joshua Kimmich" or "Harry Maguire". */
export function formatDisplayName(
  apiName: string,
  firstname?: string | null,
  lastname?: string | null,
  aliases: string[] = [],
  abbreviatedName?: string | null
): string {
  const trimmedApi = apiName.trim();
  const first = firstname?.trim() ?? '';
  const last = lastname?.trim() || trimmedApi.split(/\s+/).pop() || '';

  if (!last) return trimmedApi;

  const parts = givenNameParts(trimmedApi, first, last);
  const lastNorm = last.toLowerCase();

  // Squad-list initials (J. Kimmich) → expand to the known given name before legal first token.
  if (isAbbreviatedName(trimmedApi)) {
    const apiMatch = trimmedApi.match(INITIAL_ALIAS_RE);
    const initial = apiMatch?.[1]?.toLowerCase();
    if (initial) {
      const hits = parts.filter((part) => part[0]?.toLowerCase() === initial);
      if (hits.length === 1) {
        return `${hits[0]} ${last}`;
      }
      if (hits.length > 1) {
        const firstToken = first.split(/\s+/).filter(Boolean)[0];
        const preferred =
          (firstToken && hits.find((part) => part.toLowerCase() === firstToken.toLowerCase())) ??
          hits.find((part) => part.toLowerCase() !== firstToken?.toLowerCase()) ??
          hits.find((part) => !isInitialToken(part)) ??
          hits[0];
        return `${preferred} ${last}`;
      }
    }
  }

  // API already uses a common two-part name that matches a given-name part (Joshua Kimmich).
  const apiTokens = trimmedApi.split(/\s+/).filter(Boolean);
  if (
    apiTokens.length === 2 &&
    apiTokens[1]!.toLowerCase() === lastNorm &&
    !isAbbreviatedName(apiTokens[0]!)
  ) {
    const apiFirst = apiTokens[0]!;
    if (parts.some((part) => part.toLowerCase() === apiFirst.toLowerCase())) {
      return trimmedApi;
    }
  }

  const firstGiven = first.split(/\s+/).filter(Boolean)[0];
  // Prefer the common first name from API profile data over abbreviated squad-list names.
  if (firstGiven && !isAbbreviatedName(firstGiven)) {
    return `${firstGiven} ${last}`;
  }

  const abbreviated = abbreviatedName?.trim();
  const preferredInitial = abbreviated?.match(INITIAL_ALIAS_RE)?.[1]?.toLowerCase();

  if (preferredInitial) {
    const hits = parts.filter((part) => part[0]?.toLowerCase() === preferredInitial);
    if (hits.length === 1) {
      return `${hits[0]} ${last}`;
    }
    if (hits.length > 1) {
      const firstToken = first.split(/\s+/).filter(Boolean)[0];
      const preferred =
        (firstToken && hits.find((part) => part.toLowerCase() === firstToken.toLowerCase())) ??
        hits.find((part) => !isInitialToken(part)) ??
        firstToken ??
        hits[0];
      return `${preferred} ${last}`;
    }
  }

  const initialAliases = aliases
    .map((alias) => alias.match(INITIAL_ALIAS_RE))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .filter(([, , aliasLast]) => aliasLast.toLowerCase() === lastNorm);

  if (isAbbreviatedName(trimmedApi)) {
    const apiMatch = trimmedApi.match(INITIAL_ALIAS_RE);
    if (apiMatch) initialAliases.unshift(apiMatch);
  }

  for (const match of initialAliases) {
    if (!match) continue;
    const initial = match[1]?.toLowerCase();
    if (!initial) continue;
    const hits = parts.filter((part) => part[0]?.toLowerCase() === initial);
    if (hits.length === 1) {
      return `${hits[0]} ${last}`;
    }
  }

  const fallbackGiven = parts[0];
  if (fallbackGiven && !isAbbreviatedName(fallbackGiven)) {
    return `${fallbackGiven} ${last}`;
  }

  return trimmedApi;
}

export function buildPlayerSearchFields(
  apiName: string,
  firstname?: string | null,
  lastname?: string | null,
  abbreviatedName?: string | null
): { name: string; aliases: string[]; searchText: string } {
  const trimmedApi = apiName.trim();
  const first = firstname?.trim() ?? '';
  const last = lastname?.trim() ?? '';
  const legalName = first && last ? `${first} ${last}` : trimmedApi;
  const abbreviated = abbreviatedName?.trim();

  const aliases = new Set<string>([trimmedApi, legalName]);
  if (abbreviated) aliases.add(abbreviated);
  if (last) aliases.add(last);
  if (first) aliases.add(first);

  const parts = givenNameParts(trimmedApi, first, last);
  for (const part of parts) {
    if (last) {
      aliases.add(`${part[0]}. ${last}`);
    }
  }

  if (parts.length > 1) {
    aliases.add(parts[parts.length - 1]!);
  }

  const aliasList = [...aliases];
  const displayName = formatDisplayName(trimmedApi, first, last, aliasList, abbreviated);
  aliases.add(displayName);

  const searchText = [...aliases].map(normalizeSearchText).join(' ');

  return {
    name: displayName,
    aliases: [...aliases],
    searchText,
  };
}
