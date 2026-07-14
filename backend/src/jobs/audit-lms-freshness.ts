import 'dotenv/config';
import { auditLMSFreshness } from '../services/lastManStanding/freshnessAudit.js';

const report = await auditLMSFreshness();
console.log(`LMS freshness audit — ${report.lookbackDays} days from ${report.cutoffDate}`);
for (const [type, result] of Object.entries(report.byType)) {
  console.log(
    `${type.padEnd(14)} bank ${String(result.activeBank).padStart(3)}/${result.cooldownMinimum} ` +
    `${result.meetsCooldownInventory ? 'READY' : 'LOW  '} · recent ${result.recentQuestions} · ` +
    `exact repeats ${result.repeatedOccurrences} across ${result.repeatedSignatures} signatures`
  );
}
process.exit(0);
