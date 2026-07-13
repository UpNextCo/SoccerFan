import { z } from 'zod';

export interface QuestionTemplateActivationInput {
  mode: string;
  config: Record<string, unknown>;
}

const oneMoreConfigSchema = z.object({
  metricId: z.string().trim().min(1),
  threshold: z.number().int().min(0).max(100_000),
  valueNoun: z.string().trim().min(1).max(80),
}).passthrough();

export function validateQuestionTemplateActivation(
  input: QuestionTemplateActivationInput,
  supportedOneMoreMetricIds: ReadonlySet<string>
): { ok: true } | { ok: false; error: string } {
  if (input.mode !== 'one_more') {
    return { ok: false, error: `Unsupported active template mode: ${input.mode}` };
  }
  const parsed = oneMoreConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'One More templates require metricId, integer threshold, and valueNoun.',
    };
  }
  if (!supportedOneMoreMetricIds.has(parsed.data.metricId)) {
    return {
      ok: false,
      error: `Unknown One More metric: ${parsed.data.metricId}`,
    };
  }
  return { ok: true };
}
