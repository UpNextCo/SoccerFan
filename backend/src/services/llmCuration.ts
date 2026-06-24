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
  totalAnswers: number; // -1 = closed set (e.g. "name a PL club")
  famousAnswers: number; // -1 = closed set
  samples: string[]; // real, most-famous-first example answers
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
  count = 45
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
    'CRITICAL: rules can only express AND, never OR. Never write "or" in a prompt (no',
    '"Barcelona or Real Madrid", no "Spanish or Italian"). Each prompt must read as a single',
    'unambiguous condition that exactly matches its rule.',
    '  minPlApps / minPlGoals / minPlAssists: integer (Premier League career totals)',
    '  minUclGoals / minUclApps: integer (Champions League career totals)',
    '  uclWinner: boolean',
    '',
    'The natural-language "prompt" MUST exactly match its rule. Only reference the allowed',
    'clubs and nationalities. Stat data only covers 2010+ for PL/UCL, so keep thresholds',
    'reasonable (PL apps up to ~300, PL goals up to ~150, UCL goals up to ~60).',
    'Return ONLY JSON.',
  ].join('\n');

  const user = [
    `Allowed clubs: ${vocab.clubs.join(', ')}`,
    `Allowed nationalities: ${vocab.nationalities.join(', ')}`,
    '',
    `Produce ${count} prompts. Return JSON exactly:`,
    '{"prompts":[{"prompt":"...","rule":{...},"difficulty":0-100}]}',
    'Ensure a smooth spread of difficulty values and minimal repetition of themes.',
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
    'On each floor the player must NAME someone matching a prompt. Rate how HARD each',
    'prompt is for a typical engaged football fan, from 0 (trivially easy) to 100 (very hard).',
    '',
    'Judge by how easily a fan can RECALL a valid answer — driven by how ICONIC/famous the',
    'answers are — NOT by how many answers exist. Example: "played for both Arsenal and',
    'Chelsea" has few answers but they are iconic (Ashley Cole, Petr Cech, Willian) so it is',
    'EASY. Obscure stat thresholds, niche nationalities, or prompts whose sample answers are',
    'unfamiliar should score HIGH. Use the provided sample answers to gauge fame.',
    '',
    'Return ONLY JSON, no prose.',
  ].join('\n');

  const lines = items.map((i) => {
    const meta = i.totalAnswers < 0 ? 'closed set' : `${i.totalAnswers} total answers, ${i.famousAnswers} well-known`;
    const examples = i.samples.length ? i.samples.join(', ') : 'n/a';
    return `[${i.id}] "${i.prompt}" — ${meta}; example answers (famous first): ${examples}`;
  });
  const user = `Rate every prompt below.\n\n${lines.join('\n')}\n\nReturn JSON exactly: {"ratings":[{"id":"<id>","difficulty":<0-100>}]} covering all ids.`;

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
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
