import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  buildGolfHole,
  evaluateGolfRule,
  golfPromptCopy,
  type GolfHole,
  type GolfRuleEvaluation,
} from './footballGolfGenerator.js';
import { towerRuleSchema, type TowerRule } from './towerRuleSchema.js';
import { golfRuleSignature } from './golfRuleSignature.js';

export interface AdminGolfTemplate {
  id: string;
  prompt: string;
  rule: TowerRule;
  ruleSignature: string;
  tier: string;
  difficulty: number;
  validAnswers: number;
  sampleAnswers: string[];
  usedCount: number;
  lastUsedDate: string | null;
}

interface GolfTemplateRow {
  id: string;
  prompt: string;
  rule: unknown;
  tier: string;
  difficulty: number;
  valid_answers: number;
  sample_answers: string[];
  used_count: number;
  last_used_date: string | null;
}

function compareGolfTemplates(a: AdminGolfTemplate, b: AdminGolfTemplate): number {
  const aPreferred = a.validAnswers >= 8 && a.validAnswers <= 100 ? 0 : 1;
  const bPreferred = b.validAnswers >= 8 && b.validAnswers <= 100 ? 0 : 1;
  return aPreferred - bPreferred
    || a.usedCount - b.usedCount
    || a.difficulty - b.difficulty
    || a.prompt.localeCompare(b.prompt)
    || a.id.localeCompare(b.id);
}

/** Choose one deterministic representative for each semantic rule. */
export function dedupeAdminGolfTemplates(
  templates: AdminGolfTemplate[]
): AdminGolfTemplate[] {
  const bestByRule = new Map<string, AdminGolfTemplate>();
  for (const template of templates) {
    const current = bestByRule.get(template.ruleSignature);
    if (!current || compareGolfTemplates(template, current) < 0) {
      bestByRule.set(template.ruleSignature, template);
    }
  }
  return [...bestByRule.values()].sort(compareGolfTemplates);
}

function adminGolfTemplateFromRow(row: GolfTemplateRow): AdminGolfTemplate | null {
  const rule = towerRuleSchema.safeParse(row.rule);
  if (!rule.success) return null;
  return {
    id: row.id,
    prompt: golfPromptCopy(row.prompt),
    rule: rule.data,
    ruleSignature: golfRuleSignature(rule.data),
    tier: row.tier,
    difficulty: row.difficulty,
    validAnswers: row.valid_answers,
    sampleAnswers: Array.isArray(row.sample_answers) ? row.sample_answers : [],
    usedCount: row.used_count,
    lastUsedDate: row.last_used_date,
  };
}

export async function listAdminGolfTemplates(query = '', limit = 30): Promise<AdminGolfTemplate[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const rows = (await db.execute(sql`
    SELECT id, prompt, rule, tier, difficulty, valid_answers, sample_answers,
           used_count, last_used_date
    FROM tower_prompts
    WHERE status = 'active'
      AND answer_type = 'player'
      AND valid_answers BETWEEN 6 AND 100
      AND (${normalizedQuery} = '' OR position(${normalizedQuery} in lower(prompt)) > 0)
    ORDER BY
      CASE WHEN valid_answers BETWEEN 10 AND 60 THEN 0 ELSE 1 END,
      used_count ASC,
      difficulty ASC,
      prompt ASC
  `)) as unknown as GolfTemplateRow[];

  return dedupeAdminGolfTemplates(
    rows.flatMap((row) => {
      const template = adminGolfTemplateFromRow(row);
      return template ? [template] : [];
    })
  ).slice(0, limit);
}

async function getAdminGolfTemplate(templateId: string): Promise<AdminGolfTemplate | null> {
  const rows = (await db.execute(sql`
    SELECT id, prompt, rule, tier, difficulty, valid_answers, sample_answers,
           used_count, last_used_date
    FROM tower_prompts
    WHERE id = ${templateId}::uuid AND status = 'active' AND answer_type = 'player'
    LIMIT 1
  `)) as unknown as GolfTemplateRow[];
  const row = rows[0];
  if (!row) return null;
  const template = adminGolfTemplateFromRow(row);
  if (!template) {
    throw new Error('Selected template contains an unsupported Tower rule.');
  }
  return template;
}

export async function previewAdminGolfRule(prompt: string, rule: TowerRule): Promise<GolfRuleEvaluation> {
  return evaluateGolfRule(prompt, rule);
}

export async function generateAdminGolfHole(input: {
  prompt: string;
  rule: TowerRule;
  holeNumber: number;
  holeId?: string;
}): ReturnType<typeof buildGolfHole> {
  return buildGolfHole(input);
}

export async function generateAdminGolfHoleFromTemplate(input: {
  templateId: string;
  holeNumber: number;
  promptOverride?: string;
}): Promise<{ hole: GolfHole; evaluation: GolfRuleEvaluation; template: AdminGolfTemplate }> {
  const template = await getAdminGolfTemplate(input.templateId);
  if (!template) throw new Error('Golf template not found.');
  const generated = await buildGolfHole({
    prompt: input.promptOverride ?? template.prompt,
    rule: template.rule,
    holeNumber: input.holeNumber,
    templateId: template.id,
  });
  return { ...generated, template };
}

export interface GolfAnswerSetValidation {
  valid: boolean;
  expectedCount: number;
  storedCount: number;
  missingAnswerIds: string[];
  staleAnswerIds: string[];
  evaluation: GolfRuleEvaluation;
}

export function compareGolfAnswerIds(expectedIds: string[], storedIds: string[]): Omit<GolfAnswerSetValidation, 'evaluation'> {
  const expected = new Set(expectedIds);
  const stored = new Set(storedIds);
  const missingAnswerIds = [...expected].filter((id) => !stored.has(id)).sort();
  const staleAnswerIds = [...stored].filter((id) => !expected.has(id)).sort();
  return {
    valid: missingAnswerIds.length === 0
      && staleAnswerIds.length === 0
      && stored.size === storedIds.length,
    expectedCount: expected.size,
    storedCount: storedIds.length,
    missingAnswerIds,
    staleAnswerIds,
  };
}

export async function validateAdminGolfHole(
  hole: Pick<GolfHole, 'prompt' | 'rule' | 'answers'>
): Promise<GolfAnswerSetValidation | { valid: true; warning: string }> {
  if (!hole.rule) {
    return { valid: true, warning: 'Legacy Golf hole has no structured rule; answers cannot be database-verified.' };
  }
  const evaluation = await evaluateGolfRule(hole.prompt, hole.rule);
  return {
    ...compareGolfAnswerIds(
      evaluation.answers.map((answer) => answer.id),
      hole.answers.map((answer) => answer.id)
    ),
    evaluation,
  };
}
