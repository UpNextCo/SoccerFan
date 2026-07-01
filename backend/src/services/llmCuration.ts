/**
 * LLM curation layer (Claude). The model judges PERCEIVED difficulty of quiz prompts
 * from the REAL sample answers we hand it — it never asserts facts and never validates
 * answers (the DB owns both). It can't get facts wrong because it only ranks our own
 * DB-verified prompts. Falls back to null on any failure so callers use pure-data logic.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { TowerRule } from './towerRules.js';

export interface CurationItem {
  id: string;
  prompt: string;
  samples: string[]; // real, most-famous-first example answers (the difficulty signal)
}

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';

export interface ProposedPrompt {
  prompt: string;
  rule: TowerRule;
  answerType: 'player';
  difficulty: number; // 0-100, Claude's judgement
}

/**
 * Ask Claude to author a varied set of Football Tower prompts spanning easy→very hard,
 * each expressed in our machine rule schema using ONLY the supplied clubs/nationalities.
 * Returns proposals; the caller MUST verify each rule against the DB (solvability) before
 * use — Claude never asserts who qualifies. Returns null on failure.
 */
export async function proposeTowerPrompts(
  vocab: { clubs: string[]; nationalities: string[] },
  avoid: string[] = [],
  count = 60,
  focus: 'all' | 'hard' = 'all'
): Promise<ProposedPrompt[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const system = [
    'You design prompts for a daily football game "Football Tower". Each prompt asks the',
    'player to NAME a footballer who matches a rule. You must output prompts spanning the',
    'full difficulty range, from trivially easy (floor 1) to very hard (floor 40), with a',
    'good spread and lots of variety.',
    '',
    'Rate difficulty by how hard it is for an engaged fan to RECALL any valid answer — i.e.',
    'how iconic the answers are — NOT how many exist. "Played for both Arsenal and Chelsea"',
    'is EASY (Cole, Cech, Willian). Make HARD prompts by combining 2-3 constraints or using',
    'niche nationalities/stat thresholds whose qualifying players are obscure.',
    '',
    'Each prompt MUST be expressible with this rule schema (omit unused fields):',
    '  nationality: string (one of the allowed nationalities)',
    '  nonEuropean: boolean',
    '  position: "Goalkeeper" | "Defender"',
    '  leaguePlayed: one of "Premier League","La Liga","Serie A","Bundesliga","Ligue 1"',
    '  playedFor: string[] (clubs from the allowed list; player must have played for ALL of them)',
    '',
    '  minPlApps / minPlGoals / minPlAssists: integer (Premier League career totals)',
    '  minPlYellowCards: integer (PL career yellow cards — disciplinary prompts)',
    '  minPlCleanSheets: integer (PL career clean sheets — goalkeepers)',
    '  minUclGoals / minUclApps: integer (Champions League career totals)',
    '  uclWinner: boolean',
    '  minPeakValueEur: integer (career-peak market value in EUROS, e.g. 100000000 = €100m)',
    '  minRecordFeeEur: integer (biggest career transfer fee in EUROS, e.g. 80000000 = €80m)',
    '',
    'CRITICAL: rules can only express AND, never OR. Never write "or" in a prompt (no',
    '"Barcelona or Real Madrid", no "Spanish or Italian"). Each prompt must read as a single',
    'unambiguous condition that exactly matches its rule.',
    '',
    'VARIETY IS ESSENTIAL: do NOT make most prompts "played in league X". Spread prompt types',
    'across nationalities, club combinations, goal/assist/appearance/yellow-card/clean-sheet',
    'thresholds, big market values (€80m+ peak), record transfer fees (€60m+), Champions',
    'League stats, and sensible COMBINATIONS (e.g. "a defender with 100+ PL apps who has won',
    'the Champions League").',
    '',
    ...(focus === 'hard'
      ? [
          'Generate ONLY genuinely HARD and ELITE prompts — every prompt\'s MOST famous valid',
          'answer must be a player a casual fan would NOT instantly know. Use niche nationality ×',
          'a NON-Premier-League league (Scottish in La Liga, Ghanaian in the Bundesliga), small-',
          'nation goalkeepers/defenders abroad, lower-profile club pairings, or 3-constraint',
          'combinations. Do NOT produce accessible prompts (famous nationality in the PL, iconic',
          'club pairings) — we already have plenty of those.',
        ]
      : [
          'GIVE A FULL, EVEN SPREAD across difficulty — roughly a third ACCESSIBLE, a third HARD,',
          'a third ELITE:',
          '- Accessible (a casual fan names one within seconds): a famous nationality in the Premier',
          '  League (Senegalese, Ivorian, Argentine in the PL), or an iconic club pairing.',
          '- Hard: niche nationality × a NON-Premier-League league (Scottish in La Liga, Ghanaian in',
          '  the Bundesliga), or 2-constraint combinations.',
          '- Elite: even the MOST famous valid answer is a player casual fans would NOT know —',
          '  small-nation goalkeepers/defenders abroad, or 3-constraint combinations.',
          'We need enough of EACH tier to build a 15-floor climb that starts accessible and ends',
          'genuinely elite.',
        ]),
    '',
    'The natural-language "prompt" MUST exactly match its rule. Only reference the allowed',
    'clubs and nationalities. Stat data only covers 2010+ for PL/UCL, so keep thresholds',
    'reasonable (PL apps ~300, PL goals ~150, PL assists ~120, PL yellows ~80, UCL goals ~60,',
    'peak value ~€200m, fee ~€220m).',
    'Return ONLY JSON.',
  ].join('\n');

  const avoidBlock = avoid.length
    ? `\nThese prompts were used on recent days — DO NOT reuse or lightly reword them; create genuinely different ones:\n${avoid.slice(0, 80).map((p) => `- ${p}`).join('\n')}\n`
    : '';

  const user = [
    `Allowed clubs: ${vocab.clubs.join(', ')}`,
    `Allowed nationalities: ${vocab.nationalities.join(', ')}`,
    avoidBlock,
    `Produce ${count} prompts. Return JSON exactly:`,
    '{"prompts":[{"prompt":"...","rule":{...},"difficulty":0-100}]}',
    'Ensure a smooth spread of difficulty values and strong variety from the recent prompts above.',
  ].join('\n');

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = JSON.parse(extractJson(text)) as { prompts?: Array<{ prompt: string; rule: TowerRule; difficulty: number }> };
    if (!parsed.prompts?.length) return null;
    return parsed.prompts
      .filter((p) => p.prompt && p.rule && typeof p.difficulty === 'number')
      .map((p) => ({ prompt: p.prompt.trim(), rule: p.rule, answerType: 'player' as const, difficulty: Math.max(0, Math.min(100, p.difficulty)) }));
  } catch (err) {
    console.warn(`LLM prompt proposal failed (${err instanceof Error ? err.message : String(err)}); using static templates.`);
    return null;
  }
}

/**
 * Ask Claude to NOMINATE recognisable "stinker" players for a Blind Rank theme — names a fan
 * would groan at if they turned up in an otherwise elite list (expensive flops, cult-bad
 * players, big-hype disappointments). Claude only supplies CULTURAL recall (who's a punchline);
 * the caller MUST resolve every name against the DB and discard anything unknown — so a
 * hallucinated or unrecognised name can never reach the game. Returns names, or null on failure.
 */
export async function nominateStinkers(
  themeTitle: string,
  universeDesc: string,
  count = 50
): Promise<string[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const system = [
    'You curate a daily football game called "Blind Rank". In each round the player ranks a set',
    'of footballers by a stat. To keep it fun we sprinkle in "stinkers": GENUINELY RECOGNISABLE',
    'players who fans consider underwhelming — the "oh no, not him" names in an otherwise elite',
    'list. Your ONLY job is to name such players for a given theme.',
    '',
    'What counts as a stinker:',
    '- Expensive flops / big-money signings who flopped (e.g. a club-record buy who barely played).',
    '- Cult-bad or meme players fans rib (perennial benchwarmers, panic buys, "how was he at that club?").',
    '- Hyped prospects who never delivered.',
    'They MUST be recognisable to an engaged fan — NOT obscure lower-league players. Prefer a mix of',
    'famous flops and quieter "wait, HIM?" names. Do not include genuinely great players.',
    '',
    'Return ONLY JSON: {"players":["Full Name", ...]}. Use the common full name of each player.',
  ].join('\n');

  const user = [
    `Theme: ${themeTitle}`,
    `Players in this theme: ${universeDesc}`,
    `List ${count} recognisable stinkers who fit this theme. JSON only: {"players":["..."]}.`,
  ].join('\n');

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = JSON.parse(extractJson(text)) as { players?: string[] };
    if (!parsed.players?.length) return null;
    return parsed.players.map((p) => p.trim()).filter(Boolean);
  } catch (err) {
    console.warn(`Stinker nomination failed (${err instanceof Error ? err.message : String(err)}).`);
    return null;
  }
}

/**
 * World Cup XI clue authoring (Claude). The game shows 11 clues as a 4-3-3 and the player must
 * NAME each footballer, drawn from ACROSS all World Cups — so every clue must carry its own year.
 *
 * Claude supplies cultural recall + clue wording ONLY. The caller MUST resolve every proposal to a
 * player who was actually in that nation's squad that year (DB) and a human validates the bank — so
 * no hallucinated fact ships. We deliberately steer Claude toward robust, well-documented facts and
 * away from fragile advanced metrics the DB can't check.
 */
export interface ClueProposal {
  player: string;
  country: string;
  position: 'GK' | 'DF' | 'MF' | 'FW';
  year: number;
  clue: string;
}

/** Shared brief describing the exact clue style/quality bar. */
function clueSystemPrompt(): string {
  return [
    'You write clues for a daily football quiz called "World Cup XI". The player sees 11 clues laid',
    'out as a 4-3-3 on a pitch and must NAME the footballer for each.',
    '',
    'IMPORTANT — the app already shows the player, ABOVE each clue: the tournament ("2018 World Cup")',
    'and the club they were at then ("In 2018, played for Chelsea" + the club badge). So your clue',
    'must NOT state the tournament year and must NOT name the player\'s club at that World Cup — that',
    'context is given. Just write the distinguishing clue itself. (You MAY reference a DIFFERENT year',
    'only when the feat genuinely spans tournaments, e.g. "scored at three different World Cups".)',
    '',
    'Each clue MUST:',
    '- Lead with the position ("The goalkeeper who…", "The left-back who…", "The midfielder who…",',
    '  "The striker who…") — phrased naturally.',
    '- Hinge on ONE clearly identifying fact a knowledgeable fan can use: an award (Golden',
    '  Boot/Ball/Glove, Best Young Player), a record (all-time top scorer, most appearances), a',
    '  specific decisive moment (scored in the final, scored in a semi-final, sent off, an own goal,',
    '  saved penalties in a shootout, a famous goal), a captaincy, or an age/debut record. Refer to',
    '  the tournament generically ("the tournament", "the final", "the quarter-final") — the year is',
    '  shown separately.',
    '- Resolve to EXACTLY ONE player at that tournament.',
    '- NEVER contain the player\'s name, the year, or the club they played for at that World Cup.',
    '',
    'EXACTLY the style and quality we want (year + club are shown above, so they are absent here):',
    '  - "The goalkeeper who won the Golden Glove" (Casillas, 2010)',
    '  - "The left-back who played every minute of the tournament" (Capdevila, 2010)',
    '  - "The defender who scored a famous volley against Portugal in the group stage" (Nacho, 2018)',
    '  - "The midfielder who assisted the winning goal in the final" (Fàbregas, 2010)',
    '  - "The striker who has scored at three different World Cups" (Fernando Torres)',
    '  - "The defender who scored the winning goal in the semi-final" (Puyol, 2010)',
    '  - "The midfielder who scored the winning penalty in the last-16 shootout against Colombia" (Dier, 2018)',
    '',
    'TRUTHFULNESS:',
    '- Every clue must be TRUE and unambiguous. Prefer facts that are well-documented and beyond',
    '  dispute (awards, finals, records, captaincies, red cards, famous goals).',
    '- Only claim a major award (Golden Ball/Boot/Glove or Best Young Player) when you are CERTAIN',
    '  the player WON it that year — never give it to a runner-up, and do NOT claim silver/bronze',
    '  placements (they will be rejected).',
    '- AVOID fragile advanced metrics that are hard to verify or vary by data source (e.g. "highest',
    '  tackles per 90", "best average rating", exact per-90 numbers). Stick to facts a fan would',
    '  confidently agree with.',
    '',
    'RECOGNISABILITY: these need NOT all be iconic moments — solid, identifiable squad players are',
    'welcome — but every player should be someone a knowledgeable fan could reasonably name from the',
    'clue. Avoid pure journeymen with no real hook.',
    '',
    'Use each player\'s common full name and a position tag (GK, DF, MF or FW). Spread across',
    'positions and INCLUDE goalkeepers, full-backs and wingers (not just centre-backs and strikers).',
    'Return ONLY JSON.',
  ].join('\n');
}

function avoidBlock(avoid: string[]): string {
  if (!avoid.length) return '';
  return [
    '',
    'Do NOT propose any of these players (already covered) — choose different ones:',
    avoid.slice(0, 160).map((p) => `- ${p}`).join('\n'),
  ].join('\n');
}

type RawClue = { player: string; country?: string; position: string; year?: number; clue: string };

/**
 * Parse the `players` array, tolerating a response that ran into the token limit mid-array: rather
 * than discard a near-complete reply, salvage every complete object up to the last closing brace.
 */
function parseClueArray(text: string): RawClue[] | null {
  const json = extractJson(text);
  const tryParse = (s: string): RawClue[] | null => {
    try { return ((JSON.parse(s) as { players?: RawClue[] }).players) ?? null; } catch { return null; }
  };
  const direct = tryParse(json);
  if (direct) return direct;
  // Salvage: keep the array from its '[' up to the last complete '}', then re-close it.
  const arrStart = json.indexOf('[');
  const lastObj = json.lastIndexOf('}');
  if (arrStart >= 0 && lastObj > arrStart) {
    const salvaged = tryParse(`{"players":${json.slice(arrStart, lastObj + 1)}]}`);
    if (salvaged?.length) return salvaged;
  }
  return null;
}

async function runClueProposal(user: string, fallbackYear?: number): Promise<ClueProposal[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: clueSystemPrompt(),
      messages: [{ role: 'user', content: user }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const players = parseClueArray(text);
    if (!players?.length) return null;
    return players
      .filter((p) => p.player && p.clue && ['GK', 'DF', 'MF', 'FW'].includes(p.position))
      .map((p) => ({
        player: p.player.trim(),
        country: (p.country ?? '').trim(),
        position: p.position as ClueProposal['position'],
        year: Number(p.year ?? fallbackYear ?? 0),
        clue: p.clue.trim(),
      }))
      .filter((p) => p.year >= 1990 && p.year <= 2030);
  } catch (err) {
    console.warn(`Clue proposal failed (${err instanceof Error ? err.message : String(err)}).`);
    return null;
  }
}

/**
 * Author identifying clues for ONE national team across the World Cups it appeared in, position by
 * position (the structure mirrors how a quiz writer thinks: a GK, full-backs, centre-backs, mids,
 * forwards). Each proposal carries the specific year so the caller can squad-verify it.
 */
export async function proposeTeamClues(
  country: string,
  years: number[],
  avoid: string[] = [],
  count = 24,
): Promise<ClueProposal[] | null> {
  const user = [
    `National team: ${country}.`,
    `Tournaments to draw from: ${years.join(', ')} World Cups.`,
    `List up to ${count} fair, single-answer clues for ${country}'s recognisable World Cup players,`,
    'spread across goalkeeper, full-backs, centre-backs, midfielders and forwards, and across',
    'different tournaments. Return the correct "year" for each, but do NOT put the year or the',
    'player\'s club into the "clue" text — those are shown separately.',
    `For each item: {"player":"Full Name","country":"${country}","position":"GK|DF|MF|FW","year":<YYYY>,"clue":"The <position> who ..."}.`,
    avoidBlock(avoid),
    'Return ONLY JSON: {"players":[ ... ]}.',
  ].join('\n');
  return runClueProposal(user);
}

/**
 * Catch-all pass: identifying clues for recognisable players from a single World Cup across ALL
 * nations (scoops up players the per-team passes for major nations won't reach).
 */
export async function proposeYearClues(
  year: number,
  avoid: string[] = [],
  count = 40,
): Promise<ClueProposal[] | null> {
  const user = [
    `World Cup: ${year}.`,
    `List up to ${count} fair, single-answer clues for recognisable players from the ${year} World`,
    'Cup, spread across positions and nationalities (include goalkeepers, full-backs and wingers).',
    'Do NOT put the year or the player\'s club into the "clue" text — those are shown separately.',
    `For each item: {"player":"Full Name","country":"Nation","position":"GK|DF|MF|FW","year":${year},"clue":"The <position> who ..."}.`,
    avoidBlock(avoid),
    'Return ONLY JSON: {"players":[ ... ]}.',
  ].join('\n');
  return runClueProposal(user, year);
}

/**
 * Polish DATA-DERIVED clues for natural wording. The facts are already true (built from the DB);
 * Claude may ONLY rephrase — never add a fact, name, year, club, number, opponent, stage or
 * descriptor, and never write in a corny/flowery way. Returns id→clue for whatever it rephrased;
 * the caller re-validates each output and falls back to the original draft on anything suspicious.
 */
export async function polishClues(items: Array<{ id: string; draft: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || items.length === 0) return out;

  const system = [
    'You lightly rewrite one-sentence clues for a football quiz. Each clue states a REAL thing a',
    'player did at a World Cup. Your ONLY job is wording — make each read naturally and confidently.',
    '',
    'HARD RULES:',
    '- DO NOT add, remove or change any fact. No new opponent, stage, number, award, competition,',
    '  year, club or descriptor. If a draft says "scored in the final" you may NOT write "scored the',
    '  winner in the final"; if it says "scored twice against Tunisia" you may NOT add how or when.',
    '- NEVER mention a year, the player\'s club, or the player\'s name.',
    '- Keep it to ONE sentence that STARTS with the position ("The goalkeeper who…", "The defender',
    '  who…", "The midfielder who…", "The forward who…").',
    '- Write plainly. NO corny, cryptic, flowery or over-dramatic language — no "talismanic",',
    '  "mercurial", "iconic", "cult hero", "netted", "the man who". Just clear and natural.',
    '- Many drafts are already fine — a light touch (or leaving it as-is) is perfectly good. Do not pad.',
    '',
    'Return ONLY JSON: {"clues":[{"id":"<id>","clue":"<rewrite>"}]} covering every id.',
  ].join('\n');

  const client = new Anthropic({ apiKey });
  for (let i = 0; i < items.length; i += 40) {
    const batch = items.slice(i, i + 40);
    const user = `Rewrite each clue's wording only.\n${batch.map((b) => `[${b.id}] ${b.draft}`).join('\n')}\n\nJSON only.`;
    try {
      const resp = await client.messages.create({ model: MODEL, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] });
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
      const parsed = JSON.parse(extractJson(text)) as { clues?: Array<{ id: string; clue: string }> };
      for (const c of parsed.clues ?? []) if (c.id && c.clue) out.set(c.id, c.clue.trim());
    } catch (err) {
      console.warn(`Polish batch failed (${err instanceof Error ? err.message : String(err)}); keeping drafts.`);
    }
  }
  return out;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/**
 * Returns a difficulty score (0 = trivial, 100 = very hard) per item id, or null if the
 * model is unavailable / fails / returns incomplete data.
 */
export async function rateTowerDifficulty(items: CurationItem[]): Promise<Map<string, number> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || items.length === 0) return null;

  const system = [
    'You are a football-quiz difficulty expert for a daily game called "Football Tower".',
    'On each floor the player must NAME ONE footballer matching the prompt. Rate how HARD',
    'each prompt is for a typical engaged football fan, 0 (trivially easy) to 100 (very hard).',
    '',
    'THE KEY QUESTION: how quickly could a fan name AT LEAST ONE valid answer? Difficulty is',
    'driven by the FAME OF THE MOST OBVIOUS ANSWER, not by how many answers exist. We list the',
    'real answers most-famous-first — look at the TOP ones:',
    '- If the most famous answer is a household name, the prompt is EASY — EVEN IF IT IS THE',
    '  ONLY ANSWER. e.g. "Slovak defender in the Premier League" → Škrtel (10 years at',
    '  Liverpool) is instantly obvious, so EASY (~20), despite being basically the only answer.',
    '- "Ghanaian defender in the Premier League" → Schlupp/Amartey/Lamptey obvious → EASY.',
    '- "Uruguayan in the Premier League" → Suárez/Cavani/Núñez → EASY (~15).',
    '- "Played for both Arsenal and Chelsea" → Cole/Cech/Willian → EASY-MEDIUM.',
    'A prompt is only HARD/ELITE when EVEN ITS MOST FAMOUS ANSWER would stump a typical fan —',
    'i.e. the best answer is an obscure journeyman a casual fan has never heard of. Do NOT rate',
    'something hard just because it has few answers; rate it hard only because the answers',
    'themselves are unfamiliar.',
    '',
    'Return ONLY JSON, no prose.',
  ].join('\n');

  const lines = items.map((i) => {
    const examples = i.samples.length ? i.samples.join(', ') : '(closed set — a club/nation, very easy)';
    return `[${i.id}] "${i.prompt}" — most famous valid answers: ${examples}`;
  });
  const user = `Rate every prompt below.\n\n${lines.join('\n')}\n\nReturn JSON exactly: {"ratings":[{"id":"<id>","difficulty":<0-100>}]} covering all ids.`;

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      temperature: 0, // deterministic, consistent difficulty calibration
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = JSON.parse(extractJson(text)) as { ratings?: Array<{ id: string; difficulty: number }> };
    if (!parsed.ratings) return null;

    const map = new Map<string, number>();
    for (const r of parsed.ratings) {
      if (typeof r.difficulty === 'number' && Number.isFinite(r.difficulty)) {
        map.set(r.id, Math.max(0, Math.min(100, r.difficulty)));
      }
    }
    // Require full coverage; otherwise fall back to pure-data ordering.
    if (items.some((i) => !map.has(i.id))) return null;
    return map;
  } catch (err) {
    console.warn(`LLM curation unavailable (${err instanceof Error ? err.message : String(err)}); using data ordering.`);
    return null;
  }
}
