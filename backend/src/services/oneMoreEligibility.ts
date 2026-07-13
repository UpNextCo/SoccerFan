export interface OneMoreEligibilityMetric {
  goalLike: boolean;
  eventBased?: boolean;
}

export interface OneMoreEligibilityCandidate {
  participation: number;
  position: string;
  birthYear: number | null;
  value: number;
}

export function oneMoreEligibilityErrors(
  metric: OneMoreEligibilityMetric,
  candidate: OneMoreEligibilityCandidate,
  threshold: number
): string[] {
  const errors: string[] = [];
  if (candidate.participation <= 0) {
    errors.push('Player has no participation for this metric.');
  }
  if (metric.goalLike && candidate.position === 'Goalkeeper') {
    errors.push('Goalkeepers are not eligible for this goal-like metric.');
  }
  if (
    metric.eventBased
    && candidate.value < threshold
    && (candidate.birthYear ?? 0) < 1990
  ) {
    errors.push('Distractor is outside the covered era for this event-based metric.');
  }
  return errors;
}
