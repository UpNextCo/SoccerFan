import { createHash } from 'node:crypto';
import type { TowerRule } from './towerRuleSchema.js';

const SIGNATURE_VERSION = 'gr2';

function exactSet(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Stable semantic identity for every selector executed by towerRules.
 * `label` is deliberately excluded because it only affects authoring copy.
 */
export function canonicalGolfRule(rule: TowerRule): Record<string, unknown> {
  return {
    // UUID comparison is case-insensitive after PostgreSQL casts; normalize only that field.
    ...(rule.validIds ? { validIds: exactSet(rule.validIds.map((id) => id.toLowerCase())) } : {}),
    // Tower executes nationality with lower(), while clubs/leagues are exact comparisons.
    ...(rule.nationality ? { nationality: rule.nationality.toLowerCase() } : {}),
    ...(rule.nonEuropean ? { nonEuropean: true } : {}),
    ...(rule.position ? { position: rule.position } : {}),
    ...(rule.leaguePlayed ? { leaguePlayed: rule.leaguePlayed } : {}),
    ...(rule.playedFor ? { playedFor: exactSet(rule.playedFor) } : {}),
    ...(typeof rule.minPlApps === 'number' ? { minPlApps: rule.minPlApps } : {}),
    ...(typeof rule.minPlAssists === 'number' ? { minPlAssists: rule.minPlAssists } : {}),
    ...(typeof rule.minPlGoals === 'number' ? { minPlGoals: rule.minPlGoals } : {}),
    ...(typeof rule.minPlYellowCards === 'number' ? { minPlYellowCards: rule.minPlYellowCards } : {}),
    ...(typeof rule.minPlCleanSheets === 'number' ? { minPlCleanSheets: rule.minPlCleanSheets } : {}),
    ...(rule.uclWinner ? { uclWinner: true } : {}),
    ...(typeof rule.minUclGoals === 'number' ? { minUclGoals: rule.minUclGoals } : {}),
    ...(typeof rule.minUclApps === 'number' ? { minUclApps: rule.minUclApps } : {}),
    ...(typeof rule.minPeakValueEur === 'number' ? { minPeakValueEur: rule.minPeakValueEur } : {}),
    ...(typeof rule.minRecordFeeEur === 'number' ? { minRecordFeeEur: rule.minRecordFeeEur } : {}),
  };
}

export function golfRuleSignature(rule: TowerRule): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(canonicalGolfRule(rule)))
    .digest('base64url')
    .slice(0, 16);
  return `${SIGNATURE_VERSION}_${digest}`;
}

export function golfRulesSemanticallyEqual(first: TowerRule, second: TowerRule): boolean {
  return golfRuleSignature(first) === golfRuleSignature(second);
}
