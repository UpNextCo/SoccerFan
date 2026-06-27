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
 * Ask Claude to recall MEMORABLE players from a specific World Cup, each with a cryptic,
 * story-based clue in the style of a fan quiz ("the masked defender who had a breakout
 * tournament" → Gvardiol; "the defender who got bitten" → Chiellini). Claude supplies cultural
 * recall + clue wording ONLY; the caller MUST resolve every name to a player who was actually in
 * that tournament's squad (DB) and a human validates the bank — so no hallucinated fact ships.
 * Returns proposals, or null on failure.
 */
export interface MemorableProposal { player: string; position: 'GK' | 'DF' | 'MF' | 'FW'; clue: string; }

export async function proposeMemorable(year: number, count = 35): Promise<MemorableProposal[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const classic = year < 2006;

  const system = [
    'You curate a daily football quiz called "World Cup XI": the player is shown 11 cryptic clues',
    'and must NAME each footballer. Your job: list the most MEMORABLE players from ONE World Cup,',
    'each with a single cryptic clue a fan would smile at — favour STORIES and iconic moments over',
    'dry stats, like these real examples:',
    '  - "The masked defender who had a breakout tournament" (Gvardiol, 2022)',
    '  - "The defender who got bitten at this World Cup" (Chiellini, 2014)',
    '  - "The midfielder whose goal clearly crossed the line but was not given" (Lampard, 2010)',
    '  - "The midfielder who finished the famous 24-pass team goal" (Cambiasso, 2006)',
    '  - "The goalkeeper sent off, who has played in the Premier League" (Hennessey, 2022)',
    '',
    'RECOGNISABILITY IS THE #1 RULE. Every player must be someone a CASUAL modern football fan',
    'would actually recognise the name of TODAY. Never include journeymen, role players, or',
    'one-tournament names that only a hardcore fan of that era would know (no "Earnie Stewart",',
    '"Oleg Salenko", "Christophe Dugarry" types).',
    '',
    ...(classic
      ? [
          `This is an OLDER World Cup (${year}). Be STRICT: include ONLY genuinely ICONIC, global`,
          'household names that today\'s casual fan still instantly knows — World Cup winners,',
          'Ballon d\'Or-level superstars, and a couple of truly unforgettable moments. If in doubt,',
          'leave a player OUT. Quality over quantity.',
        ]
      : [
          'This is a recent World Cup, so you can include the full memorable range: superstars PLUS',
          'recognisable cult/role players and big moments (red cards, own goals, golden boot/glove,',
          'captains, shock villains, breakout players).',
        ]),
    '',
    'Rules:',
    '- Every clue must be TRUE and specific to THAT World Cup, and resolve to exactly one player.',
    '- The clue must NOT contain the player\'s name. Do not state the year (the puzzle adds it).',
    '- Lead with the player\'s position word where natural ("defender", "midfielder", etc.).',
    '- Use the common full name. Give a position tag: GK, DF, MF or FW.',
    '',
    'Return ONLY JSON: {"players":[{"player":"Full Name","position":"DF","clue":"The ... who ..."}]}',
  ].join('\n');

  const user = [
    `World Cup: ${year}.`,
    `List up to ${count} memorable players from the ${year} World Cup with a cryptic, story-led clue each.`,
    classic
      ? 'Only the genuinely iconic — it is fine to return fewer than the maximum.'
      : 'Spread across positions (a few GK, several DF, several MF, several FW).',
    'JSON only.',
  ].join('\n');

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = JSON.parse(extractJson(text)) as { players?: MemorableProposal[] };
    if (!parsed.players?.length) return null;
    return parsed.players
      .filter((p) => p.player && p.clue && ['GK', 'DF', 'MF', 'FW'].includes(p.position))
      .map((p) => ({ player: p.player.trim(), position: p.position, clue: p.clue.trim() }));
  } catch (err) {
    console.warn(`Memorable proposal failed (${err instanceof Error ? err.message : String(err)}).`);
    return null;
  }
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
