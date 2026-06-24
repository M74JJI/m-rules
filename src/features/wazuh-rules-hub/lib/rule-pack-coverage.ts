import { USE_CASES } from './use-cases';
import type { ParsedCollection, RuleRecord, UseCaseRecord } from './types';

export type CoverageStatus = 'strong' | 'good' | 'weak' | 'missing' | 'noisy';

export type CoverageCell = {
  key: string;
  label: string;
  score: number;
  status: CoverageStatus;
  detail: string;
};

export type UseCaseCoverageRow = {
  useCaseId: string;
  name: string;
  category: string;
  domain: string;
  rules: number;
  helpers: number;
  detections: number;
  correlations: number;
  jiraVisible: number;
  critical: number;
  confirmedMappings: number;
  mitreTechniques: string[];
  decoderFieldsUsed: string[];
  decodedAs: string[];
  score: number;
  status: CoverageStatus;
  weakSignals: string[];
  cells: CoverageCell[];
  rulesSample: RuleRecord[];
};

export type MitreCoverageRow = {
  technique: string;
  rules: number;
  useCases: string[];
  jiraVisible: number;
  critical: number;
  score: number;
  status: CoverageStatus;
};

export type DecoderCoverageRow = {
  decoder: string;
  directRules: number;
  outputFields: number;
  usedFields: number;
  usedByRules: number;
  useCases: string[];
  score: number;
  status: CoverageStatus;
};

export type CoverageSummary = {
  rows: UseCaseCoverageRow[];
  mitre: MitreCoverageRow[];
  decoders: DecoderCoverageRow[];
  stats: {
    useCases: number;
    strong: number;
    good: number;
    weak: number;
    missing: number;
    noisy: number;
    averageScore: number;
    jiraVisibleRules: number;
    mitreTechniques: number;
    decoderFieldsUsed: number;
    unassignedRules: number;
  };
};

const uniq = <T,>(items: T[]) => [...new Set(items)];
const avg = (nums: number[]) => nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const statusOf = (score: number, noisy = false): CoverageStatus => {
  if (noisy) return 'noisy';
  if (score >= 82) return 'strong';
  if (score >= 66) return 'good';
  if (score >= 40) return 'weak';
  return 'missing';
};

const cell = (key: string, label: string, score: number, detail: string, noisy = false): CoverageCell => ({
  key,
  label,
  score: clamp(score),
  status: statusOf(score, noisy),
  detail,
});

function scoreUseCase(useCaseId: string, rules: RuleRecord[], collection: ParsedCollection, catalog: UseCaseRecord[]): UseCaseCoverageRow {
  const uc = catalog.find((u) => u.id === useCaseId);
  const helpers = rules.filter((r) => r.role === 'helper').length;
  const detections = rules.filter((r) => ['detection', 'parser_health'].includes(r.role)).length;
  const correlations = rules.filter((r) => r.role === 'correlation').length;
  const jiraVisible = rules.filter((r) => r.jiraVisible).length;
  const critical = rules.filter((r) => r.level >= 12).length;
  const confirmedMappings = rules.filter((r) => r.useCaseConfidence === 'confirmed').length;
  const mitreTechniques = uniq(rules.flatMap((r) => r.mitre)).sort();
  const decoderFieldsUsed = uniq(rules.flatMap((r) => r.fields.map((f) => f.name).filter(Boolean))).sort();
  const decodedAs = uniq(rules.flatMap((r) => r.decodedAs || [])).sort();
  const producedFields = new Set(collection.decoders.flatMap((d) => d.orderFields));
  const fieldsWithDecoder = decoderFieldsUsed.filter((f) => producedFields.has(f)).length;
  const highSingleEvent = rules.filter((r) => r.jiraVisible && r.role === 'detection' && !r.frequency && !r.timeframe).length;

  const detectionScore = rules.length ? Math.min(100, detections * 18 + correlations * 20 + jiraVisible * 12 + helpers * 3) : 0;
  const mitreScore = rules.length ? Math.min(100, mitreTechniques.length * 22 + rules.filter((r) => r.mitre.length).length * 6) : 0;
  const decoderScore = decoderFieldsUsed.length ? Math.round((fieldsWithDecoder / decoderFieldsUsed.length) * 100) : (rules.some((r) => r.decodedAs?.length) ? 65 : 35);
  const qaScore = jiraVisible ? Math.min(70, 20 + correlations * 8 + confirmedMappings * 3) : Math.min(55, 20 + detections * 5);
  const jiraScore = jiraVisible ? Math.min(100, 50 + critical * 16 + correlations * 10) : (detections || correlations ? 55 : 25);
  const standardScore = rules.length ? Math.round((confirmedMappings / rules.length) * 100) : 0;
  const noiseScore = highSingleEvent ? Math.max(25, 85 - highSingleEvent * 18) : 88;

  const cells = [
    cell('detection', 'Detection depth', detectionScore, `${detections} detections · ${correlations} correlations · ${helpers} helpers`),
    cell('mitre', 'MITRE coverage', mitreScore, `${mitreTechniques.length} techniques mapped`),
    cell('decoder', 'Decoder confidence', decoderScore, `${fieldsWithDecoder}/${decoderFieldsUsed.length || 0} used fields produced by uploaded decoders`),
    cell('qa', 'QA readiness', qaScore, 'Estimated from Jira/correlation/confirmed mapping signals'),
    cell('jira', 'Jira visibility', jiraScore, `${jiraVisible} Jira-visible · ${critical} critical`),
    cell('standard', 'Standardization', standardScore, `${confirmedMappings}/${rules.length || 0} confirmed use_case info tags`),
    cell('noise', 'Noise posture', noiseScore, `${highSingleEvent} high-level single-event noisy candidates`, highSingleEvent >= 2),
  ];

  const weakSignals: string[] = [];
  if (!rules.length) weakSignals.push('no_rules');
  if (!detections && !correlations) weakSignals.push('helper_only');
  if (!jiraVisible && (detections || correlations)) weakSignals.push('no_jira_visible_rule');
  if (!mitreTechniques.length && rules.some((r) => r.level >= 8)) weakSignals.push('no_mitre_on_detection');
  if (standardScore < 50) weakSignals.push('mostly_inferred_use_cases');
  if (decoderFieldsUsed.length && decoderScore < 70) weakSignals.push('decoder_field_gaps');
  if (highSingleEvent) weakSignals.push('high_level_single_event_noise');

  const score = avg(cells.map((c) => c.score));
  return {
    useCaseId,
    name: uc?.name || useCaseId,
    category: uc?.category || 'unregistered',
    domain: uc?.domain || 'unknown',
    rules: rules.length,
    helpers,
    detections,
    correlations,
    jiraVisible,
    critical,
    confirmedMappings,
    mitreTechniques,
    decoderFieldsUsed,
    decodedAs,
    score,
    status: statusOf(score, highSingleEvent >= 3),
    weakSignals,
    cells,
    rulesSample: rules.slice().sort((a, b) => b.level - a.level).slice(0, 10),
  };
}

export function buildRulePackCoverage(collection: ParsedCollection, catalog: UseCaseRecord[] = USE_CASES): CoverageSummary {
  const byUseCase = new Map<string, RuleRecord[]>();
  collection.rules.forEach((r) => {
    const id = r.useCaseId || 'unassigned';
    byUseCase.set(id, [...(byUseCase.get(id) || []), r]);
  });
  const allUseCaseIds = uniq([...catalog.map((u) => u.id), ...byUseCase.keys()]);
  const rows = allUseCaseIds.map((id) => scoreUseCase(id, byUseCase.get(id) || [], collection, catalog)).sort((a, b) => a.score - b.score || b.rules - a.rules);

  const mitreMap = new Map<string, RuleRecord[]>();
  collection.rules.forEach((r) => r.mitre.forEach((m) => mitreMap.set(m, [...(mitreMap.get(m) || []), r])));
  const mitre = [...mitreMap.entries()].map(([technique, rules]) => {
    const score = clamp(35 + Math.min(35, rules.length * 8) + Math.min(20, rules.filter((r) => r.jiraVisible).length * 8) + Math.min(10, uniq(rules.map((r) => r.useCaseId)).length * 3));
    return { technique, rules: rules.length, useCases: uniq(rules.map((r) => r.useCaseId)).sort(), jiraVisible: rules.filter((r) => r.jiraVisible).length, critical: rules.filter((r) => r.level >= 12).length, score, status: statusOf(score) };
  }).sort((a, b) => b.rules - a.rules || a.technique.localeCompare(b.technique));

  const rulesByDecodedAs = new Map<string, RuleRecord[]>();
  collection.rules.forEach((r) => (r.decodedAs || []).forEach((d) => rulesByDecodedAs.set(d, [...(rulesByDecodedAs.get(d) || []), r])));
  const decoderFieldUse = new Map<string, RuleRecord[]>();
  collection.rules.forEach((r) => r.fields.forEach((f) => decoderFieldUse.set(f.name, [...(decoderFieldUse.get(f.name) || []), r])));
  const decoders = collection.decoders.map((d) => {
    const usedFieldRules = uniq(d.orderFields.flatMap((f) => decoderFieldUse.get(f) || []));
    const directRules = rulesByDecodedAs.get(d.name) || [];
    const usedFields = d.orderFields.filter((f) => decoderFieldUse.has(f));
    const linkedRules = uniq([...directRules, ...usedFieldRules]);
    const score = clamp((directRules.length ? 25 : 0) + (d.orderFields.length ? 25 : 5) + (d.orderFields.length ? (usedFields.length / d.orderFields.length) * 40 : 0) + Math.min(10, linkedRules.length));
    return { decoder: d.name, directRules: directRules.length, outputFields: d.orderFields.length, usedFields: usedFields.length, usedByRules: linkedRules.length, useCases: uniq(linkedRules.map((r) => r.useCaseId)).sort(), score, status: statusOf(score) };
  }).sort((a, b) => a.score - b.score || b.outputFields - a.outputFields);

  const stats = {
    useCases: rows.filter((r) => r.rules > 0).length,
    strong: rows.filter((r) => r.status === 'strong').length,
    good: rows.filter((r) => r.status === 'good').length,
    weak: rows.filter((r) => r.status === 'weak').length,
    missing: rows.filter((r) => r.status === 'missing').length,
    noisy: rows.filter((r) => r.status === 'noisy').length,
    averageScore: avg(rows.filter((r) => r.rules > 0).map((r) => r.score)),
    jiraVisibleRules: collection.rules.filter((r) => r.jiraVisible).length,
    mitreTechniques: mitre.length,
    decoderFieldsUsed: uniq(collection.rules.flatMap((r) => r.fields.map((f) => f.name))).length,
    unassignedRules: collection.rules.filter((r) => r.useCaseId === 'unassigned').length,
  };
  return { rows, mitre, decoders, stats };
}

export function buildCoverageMarkdown(summary: CoverageSummary) {
  const lines: string[] = [];
  lines.push('# Wazuh Rule Pack Coverage Map');
  lines.push('');
  lines.push(`- Average coverage score: ${summary.stats.averageScore}/100`);
  lines.push(`- Active use cases: ${summary.stats.useCases}`);
  lines.push(`- Strong/good/weak/missing/noisy: ${summary.stats.strong}/${summary.stats.good}/${summary.stats.weak}/${summary.stats.missing}/${summary.stats.noisy}`);
  lines.push(`- Jira-visible rules: ${summary.stats.jiraVisibleRules}`);
  lines.push(`- MITRE techniques: ${summary.stats.mitreTechniques}`);
  lines.push(`- Unassigned rules: ${summary.stats.unassignedRules}`);
  lines.push('');
  lines.push('## Weakest Use Cases');
  lines.push('');
  for (const row of summary.rows.slice(0, 20)) {
    lines.push(`### ${row.name}`);
    lines.push(`- ID: ${row.useCaseId}`);
    lines.push(`- Score: ${row.score}/100 (${row.status})`);
    lines.push(`- Rules: ${row.rules}; Jira-visible: ${row.jiraVisible}; MITRE: ${row.mitreTechniques.join(', ') || 'none'}`);
    lines.push(`- Weak signals: ${row.weakSignals.join(', ') || 'none'}`);
    lines.push('');
  }
  lines.push('## MITRE Coverage');
  lines.push('');
  for (const row of summary.mitre.slice(0, 50)) lines.push(`- ${row.technique}: ${row.rules} rules, ${row.jiraVisible} Jira-visible, use cases: ${row.useCases.join(', ')}`);
  lines.push('');
  lines.push('## Decoder Coverage');
  lines.push('');
  for (const row of summary.decoders.slice(0, 50)) lines.push(`- ${row.decoder}: ${row.usedFields}/${row.outputFields} fields used, ${row.directRules} direct decoded_as rules, score ${row.score}/100`);
  return lines.join('\n');
}
