import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  questionTemplates,
  type NewQuestionTemplate,
  type QuestionTemplate,
} from '../db/schema.js';
import { listOneMoreMetrics } from './oneMoreGenerator.js';
import { validateQuestionTemplateActivation } from './questionTemplateValidation.js';

export const QUESTION_TEMPLATE_STATUSES = ['draft', 'active', 'archived'] as const;
export type QuestionTemplateStatus = (typeof QUESTION_TEMPLATE_STATUSES)[number];

export interface CreateQuestionTemplateInput {
  mode: string;
  name: string;
  prompt: string;
  config: Record<string, unknown>;
  status?: QuestionTemplateStatus;
}

export interface UpdateQuestionTemplateInput {
  mode?: string;
  name?: string;
  prompt?: string;
  config?: Record<string, unknown>;
  status?: QuestionTemplateStatus;
}

export class QuestionTemplateValidationError extends Error {}

const supportedOneMoreMetricIds = new Set(listOneMoreMetrics().map((metric) => metric.id));

function assertValidActivation(input: {
  mode: string;
  config: Record<string, unknown>;
  status: QuestionTemplateStatus;
}): void {
  if (input.status !== 'active') return;
  const result = validateQuestionTemplateActivation(input, supportedOneMoreMetricIds);
  if (!result.ok) throw new QuestionTemplateValidationError(result.error);
}

export async function listQuestionTemplates(filters?: {
  mode?: string;
  status?: QuestionTemplateStatus;
}): Promise<QuestionTemplate[]> {
  const conditions = [
    filters?.mode ? eq(questionTemplates.mode, filters.mode) : undefined,
    filters?.status ? eq(questionTemplates.status, filters.status) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
  return db
    .select()
    .from(questionTemplates)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(questionTemplates.updatedAt));
}

export async function getQuestionTemplate(id: string): Promise<QuestionTemplate | null> {
  const [row] = await db
    .select()
    .from(questionTemplates)
    .where(eq(questionTemplates.id, id))
    .limit(1);
  return row ?? null;
}

export async function createQuestionTemplate(
  input: CreateQuestionTemplateInput
): Promise<QuestionTemplate> {
  const status = input.status ?? 'draft';
  assertValidActivation({ mode: input.mode, config: input.config, status });
  const values: NewQuestionTemplate = {
    mode: input.mode,
    name: input.name,
    prompt: input.prompt,
    config: input.config,
    status,
  };
  const [row] = await db.insert(questionTemplates).values(values).returning();
  if (!row) throw new Error('Question template insert returned no row');
  return row;
}

export async function updateQuestionTemplate(
  id: string,
  input: UpdateQuestionTemplateInput
): Promise<QuestionTemplate | null> {
  const existing = await getQuestionTemplate(id);
  if (!existing) return null;
  assertValidActivation({
    mode: input.mode ?? existing.mode,
    config: input.config ?? existing.config,
    status: input.status ?? (existing.status as QuestionTemplateStatus),
  });
  const [row] = await db
    .update(questionTemplates)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(questionTemplates.id, id))
    .returning();
  return row ?? null;
}

export async function deleteQuestionTemplate(id: string): Promise<boolean> {
  const rows = await db
    .delete(questionTemplates)
    .where(eq(questionTemplates.id, id))
    .returning({ id: questionTemplates.id });
  return rows.length > 0;
}
