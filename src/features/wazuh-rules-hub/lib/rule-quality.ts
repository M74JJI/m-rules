import type { ParsedCollection, RuleRecord } from './types';

export type QualityDimension = 'quality' | 'noiseRisk' | 'decoderConfidence' | 'dependencyHealth' | 'mitreQuality' | 'jiraReadiness' | 'qaReadiness' | 'clientReadiness';

export type RuleQualityScore = {
  ruleId: string;
  description: string;
  useCaseId: string;
  level: number;
  role: string;
  status: string;
  jiraVisible: boolean;
  overall: number;
  grade: 'excellent' | 'good' | 'needs_review' | 'risky' | 'broken';
  dimensions: Record<QualityDimension, number>;
  strengths: string[];
  warnings: string[];
  recommendations: string[];
};

export type UseCaseQualityScore = {
  useCaseId: string;
  rules: number;
  jiraVisible: number;
  average: number;
  grade: RuleQualityScore['grade'];
  weakSignals: string[];
};

export type QualitySummary = {
  rules: RuleQualityScore[];
  useCases: UseCaseQualityScore[];
  stats: {
    averageOverall: number;
    excellent: number;
    good: number;
    needsReview: number;
    risky: number;
    broken: number;
    jiraReady: number;
    noisyCandidates: number;
    weakDecoderConfidence: number;
    weakMitreQuality: number;
  };
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const avg = (items: number[]) => items.length ? Math.round(items.reduce((a, b) => a + b, 0) / items.length) : 0;

const gradeOf = (score: number): RuleQualityScore['grade'] => {
  if (score >= 88) return 'excellent';
  if (score >= 74) return 'good';
  if (score >= 58) return 'needs_review';
  if (score >= 40) return 'risky';
  return 'broken';
};

function scoreRule(rule: RuleRecord, collection: ParsedCollection): RuleQualityScore {
  const strengths: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const groups = new Set(rule.groups);
  const decoderNames = new Set(collection.decoders.map((d) => d.name));
  const ruleIds = new Set(collection.rules.map((r) => r.id));
  const groupProducers = new Set<string>();
  collection.rules.forEach((r) => r.groups.forEach((g) => groupProducers.add(g)));

  let quality = 65;
  if (rule.description && rule.description.length >= 18) { quality += 12; strengths.push('Clear rule description.'); } else { quality -= 12; warnings.push('Description is missing or too short.'); }
  if (rule.groups.length >= 3) { quality += 8; strengths.push('Uses multiple group tokens for classification.'); } else { quality -= 8; warnings.push('Weak group classification.'); }
  if (rule.useCaseConfidence === 'confirmed') { quality += 10; strengths.push('Confirmed use_case metadata exists.'); }
  else if (rule.useCaseConfidence === 'inferred') { quality -= 3; warnings.push('Use case is inferred, not confirmed by <info>.'); recommendations.push(`Add <info type="text">use_case:${rule.useCaseId}</info>.`); }
  else { quality -= 18; warnings.push('Rule has no use-case mapping.'); recommendations.push('Assign a use case through Use Case Studio or Standardize tab.'); }
  if (rule.rawXml.includes('<options>no_full_log</options>') || rule.options.includes('no_full_log')) quality += 2;

  let noiseRisk = 100;
  if (rule.role === 'correlation') { noiseRisk += 8; strengths.push('Correlation logic lowers single-event noise.'); }
  if (rule.frequency || rule.timeframe) noiseRisk += 8;
  if (rule.level <= 5 && rule.jiraVisible) noiseRisk -= 30;
  if (rule.level >= 11 && !rule.mitre.length && !['helper', 'parser_health'].includes(rule.role)) noiseRisk -= 12;
  if (rule.role === 'detection' && rule.level >= 11 && !(rule.frequency || rule.timeframe)) { noiseRisk -= 18; warnings.push('High/Jira-visible single-event detection may be noisy.'); recommendations.push('Consider correlation threshold, allowlist, or lower ticketing level if noisy.'); }
  if (groups.has('authentication_success') && rule.jiraVisible) { noiseRisk -= 18; warnings.push('Successful authentication alert is Jira-visible; confirm this is intentional.'); }

  let decoderConfidence = 60;
  if (rule.decodedAs?.length) {
    const missing = rule.decodedAs.filter((d) => !decoderNames.has(d));
    if (missing.length) { decoderConfidence -= 30; warnings.push(`decoded_as references missing uploaded decoder(s): ${missing.join(', ')}.`); }
    else { decoderConfidence += 25; strengths.push('decoded_as references uploaded decoder(s).'); }
  } else if (rule.dependencies.length) {
    decoderConfidence += 10;
  } else {
    decoderConfidence -= 8; warnings.push('No direct decoder or dependency context detected.');
  }
  const usedFields = rule.fields.map((f) => f.name).filter(Boolean);
  if (usedFields.length) decoderConfidence += 8;
  const producedFields = new Set(collection.decoders.flatMap((d) => d.orderFields));
  const unknownFields = usedFields.filter((f) => !producedFields.has(f));
  if (unknownFields.length && collection.decoders.length) { decoderConfidence -= Math.min(25, unknownFields.length * 5); warnings.push(`Some rule fields are not produced by uploaded decoders: ${unknownFields.slice(0, 6).join(', ')}.`); }

  let dependencyHealth = 85;
  for (const dep of rule.dependencies) {
    if ((dep.type === 'if_sid' || dep.type === 'if_matched_sid') && !ruleIds.has(dep.value)) { dependencyHealth -= 20; warnings.push(`Missing dependency SID ${dep.value}.`); }
    if ((dep.type === 'if_group' || dep.type === 'if_matched_group') && !groupProducers.has(dep.value)) { dependencyHealth -= 15; warnings.push(`No producer found for dependency group ${dep.value}.`); }
  }
  if (!rule.dependencies.length && rule.role !== 'helper') dependencyHealth -= 5;
  if (rule.role === 'correlation' && !(rule.frequency || rule.timeframe)) { dependencyHealth -= 20; warnings.push('Correlation-like rule lacks frequency/timeframe.'); }

  let mitreQuality = 70;
  if (rule.role === 'helper' && rule.mitre.length) { mitreQuality -= 25; warnings.push('Helper rule has MITRE mapping; verify this is intentional.'); }
  if (rule.role !== 'helper' && rule.level >= 8 && rule.mitre.length) { mitreQuality += 20; strengths.push('Detection has MITRE mapping.'); }
  if (rule.role !== 'helper' && rule.level >= 11 && !rule.mitre.length) { mitreQuality -= 25; recommendations.push('Add MITRE technique mapping or document why not applicable.'); }
  if (rule.mitre.length > 3) { mitreQuality -= 6; warnings.push('Many MITRE IDs on one rule; verify mapping precision.'); }

  let jiraReadiness = rule.jiraVisible ? 70 : 55;
  if (!rule.jiraVisible) jiraReadiness += rule.role === 'helper' ? 30 : 8;
  if (rule.jiraVisible && rule.useCaseId !== 'unassigned') jiraReadiness += 10;
  if (rule.jiraVisible && rule.mitre.length) jiraReadiness += 8;
  if (rule.jiraVisible && warnings.some((w) => /missing|not produced|No producer/.test(w))) jiraReadiness -= 25;
  if (rule.jiraVisible && rule.status === 'testing') { jiraReadiness -= 8; recommendations.push('Review whether testing Jira-visible rules should be promoted or hidden.'); }

  let qaReadiness = 50;
  if (rule.jiraVisible) qaReadiness += 10;
  if (rule.role === 'correlation') qaReadiness += 10;
  if (rule.useCaseConfidence === 'confirmed') qaReadiness += 10;
  if (rule.mitre.length) qaReadiness += 6;
  recommendations.push('Attach at least one positive and one negative QA test case for high-impact rules.');

  let clientReadiness = 65;
  if (rule.useCaseId !== 'unassigned') clientReadiness += 10;
  if (rule.status === 'production') clientReadiness += 8;
  if (rule.status === 'testing' && rule.jiraVisible) clientReadiness -= 10;
  if (warnings.length > 3) clientReadiness -= 12;

  const dimensions = {
    quality: clamp(quality),
    noiseRisk: clamp(noiseRisk),
    decoderConfidence: clamp(decoderConfidence),
    dependencyHealth: clamp(dependencyHealth),
    mitreQuality: clamp(mitreQuality),
    jiraReadiness: clamp(jiraReadiness),
    qaReadiness: clamp(qaReadiness),
    clientReadiness: clamp(clientReadiness),
  };
  const overall = avg(Object.values(dimensions));
  return { ruleId: rule.id, description: rule.description, useCaseId: rule.useCaseId, level: rule.level, role: rule.role, status: rule.status, jiraVisible: rule.jiraVisible, overall, grade: gradeOf(overall), dimensions, strengths: strengths.slice(0, 5), warnings: [...new Set(warnings)].slice(0, 8), recommendations: [...new Set(recommendations)].slice(0, 8) };
}

export function buildQualitySummary(collection: ParsedCollection): QualitySummary {
  const rules = collection.rules.map((r) => scoreRule(r, collection)).sort((a, b) => a.overall - b.overall || b.level - a.level);
  const byUc = new Map<string, RuleQualityScore[]>();
  rules.forEach((r) => byUc.set(r.useCaseId, [...(byUc.get(r.useCaseId) || []), r]));
  const useCases = [...byUc.entries()].map(([useCaseId, rs]) => {
    const average = avg(rs.map((r) => r.overall));
    const weakSignals = [
      rs.some((r) => r.useCaseId === 'unassigned') ? 'unassigned rules' : '',
      rs.some((r) => r.dimensions.mitreQuality < 60) ? 'weak MITRE quality' : '',
      rs.some((r) => r.dimensions.decoderConfidence < 60) ? 'decoder confidence gaps' : '',
      rs.some((r) => r.jiraVisible && r.dimensions.jiraReadiness < 70) ? 'Jira readiness gaps' : '',
    ].filter(Boolean);
    return { useCaseId, rules: rs.length, jiraVisible: rs.filter((r) => r.jiraVisible).length, average, grade: gradeOf(average), weakSignals };
  }).sort((a, b) => a.average - b.average);
  return {
    rules,
    useCases,
    stats: {
      averageOverall: avg(rules.map((r) => r.overall)),
      excellent: rules.filter((r) => r.grade === 'excellent').length,
      good: rules.filter((r) => r.grade === 'good').length,
      needsReview: rules.filter((r) => r.grade === 'needs_review').length,
      risky: rules.filter((r) => r.grade === 'risky').length,
      broken: rules.filter((r) => r.grade === 'broken').length,
      jiraReady: rules.filter((r) => r.jiraVisible && r.dimensions.jiraReadiness >= 75).length,
      noisyCandidates: rules.filter((r) => r.dimensions.noiseRisk < 65).length,
      weakDecoderConfidence: rules.filter((r) => r.dimensions.decoderConfidence < 60).length,
      weakMitreQuality: rules.filter((r) => r.dimensions.mitreQuality < 60).length,
    },
  };
}

export function buildQualityMarkdown(summary: QualitySummary): string {
  const lines = [
    '# Wazuh Rule Quality Score Report',
    '',
    `Average overall score: **${summary.stats.averageOverall}/100**`,
    `Excellent: ${summary.stats.excellent} · Good: ${summary.stats.good} · Needs review: ${summary.stats.needsReview} · Risky: ${summary.stats.risky} · Broken: ${summary.stats.broken}`,
    '',
    '## Weakest Rules',
    '',
  ];
  summary.rules.slice(0, 40).forEach((r) => {
    lines.push(`### ${r.ruleId} — ${r.description}`);
    lines.push(`Score: **${r.overall}/100** · Grade: **${r.grade}** · Use case: \`${r.useCaseId}\` · Level: ${r.level} · Role: ${r.role}`);
    lines.push(`Dimensions: ${Object.entries(r.dimensions).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (r.warnings.length) lines.push(`Warnings: ${r.warnings.join('; ')}`);
    if (r.recommendations.length) lines.push(`Recommendations: ${r.recommendations.join('; ')}`);
    lines.push('');
  });
  lines.push('## Weakest Use Cases', '');
  summary.useCases.slice(0, 25).forEach((u) => lines.push(`- \`${u.useCaseId}\`: ${u.average}/100 · ${u.rules} rules · ${u.jiraVisible} Jira-visible · ${u.weakSignals.join(', ') || 'no major weak signal'}`));
  return lines.join('\n');
}
