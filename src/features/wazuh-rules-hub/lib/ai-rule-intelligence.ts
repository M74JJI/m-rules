import type { DecoderRecord, ParsedCollection, RuleDependency, RuleRecord } from './types';

export type AiTargetType = 'collection' | 'rule' | 'decoder' | 'use_case' | 'validation';
export type AiAnalysisMode = 'explain' | 'quality' | 'tuning' | 'false_positive' | 'dependency_chain' | 'executive';

export type AiAnalysisInput = {
  targetType: AiTargetType;
  mode: AiAnalysisMode;
  targetId?: string;
  collection: ParsedCollection;
};

export type AiFinding = {
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  detail: string;
};

export type AiAnalysisResult = {
  title: string;
  targetType: AiTargetType;
  targetId?: string;
  mode: AiAnalysisMode;
  score: number;
  summary: string;
  findings: AiFinding[];
  recommendations: string[];
  prompt: string;
  markdown: string;
};

function depValues(deps: RuleDependency[], type: string): string[] {
  return deps.filter((d) => d.type === type).map((d) => d.value);
}

const roleWeights: Record<string, number> = { helper: 35, compatibility: 40, parser_health: 52, detection: 64, correlation: 74, critical: 84, escalation: 88 };
const sevScore: Record<string, number> = { informational: 30, low: 42, medium: 58, high: 74, critical: 90 };

const list = (items: string[]) => items.length ? items.join(', ') : 'none';
const ucName = (collection: ParsedCollection, id: string) => collection.useCases.find((u) => u.id === id)?.name || id;

export function getRuleChain(rule: RuleRecord, collection: ParsedCollection, depth = 4) {
  const byId = new Map(collection.rules.map((r) => [r.id, r]));
  const visited = new Set<string>();
  const lines: string[] = [];
  const walk = (current: RuleRecord, level: number) => {
    if (visited.has(current.id) || level > depth) return;
    visited.add(current.id);
    lines.push(`${'  '.repeat(level)}- ${current.id} L${current.level} ${current.role}: ${current.description}`);
    const deps = [...depValues(current.dependencies, 'if_sid'), ...depValues(current.dependencies, 'if_matched_sid')];
    for (const dep of deps) {
      const parent = byId.get(dep);
      if (parent) walk(parent, level + 1);
      else lines.push(`${'  '.repeat(level + 1)}- external SID ${dep}`);
    }
    for (const group of [...depValues(current.dependencies, 'if_group'), ...depValues(current.dependencies, 'if_matched_group')]) {
      const producers = collection.rules.filter((x) => x.groups.includes(group)).slice(0, 8);
      lines.push(`${'  '.repeat(level + 1)}- group:${group} (${producers.length ? producers.map((p) => p.id).join(', ') : 'no local producers found'})`);
    }
  };
  walk(rule, 0);
  return lines;
}

function ruleQuality(rule: RuleRecord, collection: ParsedCollection) {
  let score = roleWeights[rule.role] ?? sevScore[rule.severity] ?? 55;
  const findings: AiFinding[] = [];
  const recommendations: string[] = [];
  if (rule.useCaseId === 'unassigned') {
    score -= 18;
    findings.push({ severity: 'high', title: 'Missing use-case mapping', detail: 'Rule has no confirmed or inferred use-case. Add <info type="text">use_case:...</info> or improve group mapping.' });
  }
  if (rule.jiraVisible && rule.mitre.length === 0 && rule.role !== 'helper') {
    score -= 12;
    findings.push({ severity: 'medium', title: 'Ticket-visible rule without MITRE', detail: 'Jira-visible/high-level rules should usually carry ATT&CK mapping when behavior is threat-relevant.' });
  }
  if (rule.level === 0 && rule.mitre.length > 0) {
    score -= 10;
    findings.push({ severity: 'medium', title: 'Helper carries MITRE', detail: 'Level-0 helper rules usually should not carry MITRE unless they represent behavior directly.' });
  }
  const decodedAsArr = rule.decodedAs || [];
  if ((rule.role === 'correlation' || rule.frequency || rule.timeframe) && (!rule.frequency || !rule.timeframe)) {
    score -= 10;
    findings.push({ severity: 'medium', title: 'Correlation threshold incomplete', detail: 'Correlation-style rules should clearly define both frequency and timeframe.' });
  }
  if (rule.fields.length === 0 && depValues(rule.dependencies, 'if_sid').length === 0 && depValues(rule.dependencies, 'if_group').length === 0 && decodedAsArr.length === 0) {
    score -= 12;
    findings.push({ severity: 'medium', title: 'Weak trigger logic', detail: 'Rule has limited visible conditions/dependencies. Confirm it is intentionally broad.' });
  }
  if (rule.groups.some((g) => g === 'testing') && rule.jiraVisible) findings.push({ severity: 'info', title: 'Testing rule is ticket-visible', detail: 'This can be valid in QA, but production routing should be reviewed before enabling.' });
  if (decodedAsArr.length && collection.decoders.length) {
    for (const decoder of decodedAsArr) {
      if (!collection.decoders.some((d) => d.name === decoder)) {
        score -= 7;
        findings.push({ severity: 'medium', title: `decoded_as not found: ${decoder}`, detail: 'Uploaded decoder set does not include this decoder name. It may be stock/external or missing from the import.' });
      }
    }
  }
  if (rule.fields.length) recommendations.push('Confirm every field used by this rule is produced by uploaded or stock decoders and exists in real telemetry.');
  if (rule.jiraVisible) recommendations.push('Validate alert volume in Jira/SIEM before production rollout and add suppressions only after evidence.');
  if (rule.frequency || rule.timeframe) recommendations.push('Test correlation with positive and negative logtest samples to avoid noisy aggregation.');
  if (!recommendations.length) recommendations.push('Keep rule enabled if positive and negative tests pass and dependencies are present on target managers.');
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, findings, recommendations };
}

function analyzeRule(rule: RuleRecord, collection: ParsedCollection, mode: AiAnalysisMode): AiAnalysisResult {
  const quality = ruleQuality(rule, collection);
  const chain = getRuleChain(rule, collection).join('\n');
  const decodedAsArr = rule.decodedAs || [];
  const trigger = [
    ...depValues(rule.dependencies, 'if_sid').map((x) => `if_sid:${x}`),
    ...depValues(rule.dependencies, 'if_group').map((x) => `if_group:${x}`),
    ...depValues(rule.dependencies, 'if_matched_sid').map((x) => `if_matched_sid:${x}`),
    ...depValues(rule.dependencies, 'if_matched_group').map((x) => `if_matched_group:${x}`),
    ...rule.fields.map((f) => `${f.name}${f.type ? `/${f.type}` : ''}=${f.value}`),
    ...decodedAsArr.map((d) => `decoded_as:${d}`),
  ];
  const summary = `${rule.id} is a ${rule.role} rule in ${ucName(collection, rule.useCaseId)}. It is level ${rule.level} (${rule.severity}), ${rule.jiraVisible ? 'ticket-visible' : 'not ticket-visible'}, and maps to MITRE ${list(rule.mitre)}.`;
  const prompt = buildRulePrompt(rule, collection, mode);
  const markdown = `# AI Rule Intelligence - ${rule.id}\n\n## Summary\n${summary}\n\n## Trigger Logic\n${trigger.length ? trigger.map((x) => `- ${x}`).join('\n') : '- No explicit trigger details extracted.'}\n\n## Dependency Chain\n${chain || '- No local dependency chain.'}\n\n## Quality Score\n${quality.score}/100\n\n## Findings\n${quality.findings.length ? quality.findings.map((f) => `- **${f.severity.toUpperCase()} - ${f.title}:** ${f.detail}`).join('\n') : '- No major findings from deterministic analysis.'}\n\n## Recommendations\n${quality.recommendations.map((r) => `- ${r}`).join('\n')}\n`;
  return { title: `Rule ${rule.id} intelligence`, targetType: 'rule', targetId: rule.id, mode, score: quality.score, summary, findings: quality.findings, recommendations: quality.recommendations, prompt, markdown };
}

function analyzeDecoder(decoder: DecoderRecord, collection: ParsedCollection, mode: AiAnalysisMode): AiAnalysisResult {
  const directRules = collection.rules.filter((r) => (r.decodedAs || []).includes(decoder.name));
  const fieldUsers = collection.rules.filter((r) => r.fields.some((f) => decoder.orderFields.includes(f.name)));
  const findings: AiFinding[] = [];
  if (!decoder.parent && decoder.name.includes('-')) findings.push({ severity: 'info', title: 'Root or standalone decoder', detail: 'No parent decoder was extracted. This can be normal for root decoders.' });
  if (decoder.orderFields.length === 0) findings.push({ severity: 'medium', title: 'No order fields extracted', detail: 'Decoder has no parsed <order> fields, so field-to-rule coverage will be limited.' });
  if (directRules.length === 0 && fieldUsers.length === 0) findings.push({ severity: 'low', title: 'No visible rule usage', detail: 'No uploaded rule directly binds to this decoder or uses fields it produces.' });
  const score = Math.max(20, Math.min(100, 50 + decoder.orderFields.length * 2 + directRules.length * 4 + fieldUsers.length));
  const summary = `${decoder.name} produces ${decoder.orderFields.length} fields, has ${decoder.regex.length} regex blocks, and is directly referenced by ${directRules.length} rules.`;
  const prompt = `Explain this Wazuh decoder and recommend SOC engineering checks.\nDecoder: ${decoder.name}\nParent: ${decoder.parent || 'none'}\nFields: ${list(decoder.orderFields)}\nDirect rules: ${list(directRules.map((r) => r.id))}`;
  const recommendations = ['Validate regex coverage against real sample logs, not only sanitized examples.', 'Review unused fields as possible opportunities for future detections.', 'Confirm parent decoder exists on every target manager.'];
  const markdown = `# AI Decoder Intelligence - ${decoder.name}\n\n## Summary\n${summary}\n\n## Parent\n${decoder.parent || 'none'}\n\n## Produced Fields\n${decoder.orderFields.length ? decoder.orderFields.map((f) => `- ${f}`).join('\n') : '- none extracted'}\n\n## Rule Usage\n- Direct decoded_as rules: ${list(directRules.map((r) => r.id))}\n- Field-using rules: ${list(fieldUsers.slice(0, 25).map((r) => r.id))}\n\n## Findings\n${findings.length ? findings.map((f) => `- **${f.severity.toUpperCase()} - ${f.title}:** ${f.detail}`).join('\n') : '- No major decoder findings.'}\n\n## Recommendations\n${recommendations.map((r) => `- ${r}`).join('\n')}\n`;
  return { title: `Decoder ${decoder.name} intelligence`, targetType: 'decoder', targetId: decoder.name, mode, score: Math.round(score), summary, findings, recommendations, prompt, markdown };
}

function analyzeCollection(collection: ParsedCollection, mode: AiAnalysisMode): AiAnalysisResult {
  const rules = collection.rules;
  const critical = rules.filter((r) => r.level >= 12);
  const jira = rules.filter((r) => r.jiraVisible);
  const missingUc = rules.filter((r) => r.useCaseId === 'unassigned');
  const findings: AiFinding[] = [];
  if (missingUc.length) findings.push({ severity: 'high', title: 'Unassigned use cases', detail: `${missingUc.length} rules do not have a use-case mapping.` });
  if (collection.issues.length) findings.push({ severity: 'medium', title: 'Validation issues present', detail: `${collection.issues.length} parser or governance findings require review.` });
  const noMitreHigh = rules.filter((r) => r.level >= 11 && r.mitre.length === 0 && r.role !== 'helper');
  if (noMitreHigh.length) findings.push({ severity: 'medium', title: 'High-level rules without MITRE', detail: `${noMitreHigh.length} Jira-visible or high-level rules have no ATT&CK mapping.` });
  const score = Math.max(0, Math.min(100, 88 - missingUc.length * 2 - collection.issues.length - noMitreHigh.length));
  const summary = `Collection contains ${rules.length} rules, ${collection.decoders.length} decoders, ${collection.stats.useCases} use cases, ${jira.length} Jira-visible rules, and ${critical.length} critical rules.`;
  const recommendations = ['Add use_case info tags gradually for stable mapping and avoid relying only on group inference.', 'Prioritize validation issues that affect Jira-visible or critical rules.', 'Use Field Matrix to verify that rule fields are produced by uploaded or stock decoders.', 'Run drift checks before deploying new rule-pack versions.'];
  const prompt = `Review this Wazuh ruleset collection as a SOC engineering architect. Summarize risk, quality, tuning priorities, and production readiness. Stats: ${JSON.stringify(collection.stats)}`;
  const markdown = `# AI Collection Intelligence\n\n## Summary\n${summary}\n\n## Score\n${Math.round(score)}/100\n\n## Findings\n${findings.length ? findings.map((f) => `- **${f.severity.toUpperCase()} - ${f.title}:** ${f.detail}`).join('\n') : '- No major collection-level findings.'}\n\n## Top Use Cases\n${Array.from(new Set(rules.map((r) => r.useCaseId))).slice(0, 20).map((id) => `- ${id} - ${ucName(collection, id)}`).join('\n') || '- none'}\n\n## Recommendations\n${recommendations.map((r) => `- ${r}`).join('\n')}\n`;
  return { title: 'Collection intelligence', targetType: 'collection', mode, score: Math.round(score), summary, findings, recommendations, prompt, markdown };
}

export function buildAiAnalysis(input: AiAnalysisInput): AiAnalysisResult {
  const { collection, targetType, targetId, mode } = input;
  if (targetType === 'rule') {
    const rule = collection.rules.find((r) => r.id === targetId) || collection.rules[0];
    if (!rule) return analyzeCollection(collection, mode);
    return analyzeRule(rule, collection, mode);
  }
  if (targetType === 'decoder') {
    const decoder = collection.decoders.find((d) => d.name === targetId) || collection.decoders[0];
    if (!decoder) return analyzeCollection(collection, mode);
    return analyzeDecoder(decoder, collection, mode);
  }
  return analyzeCollection(collection, mode);
}

export function buildRulePrompt(rule: RuleRecord, collection: ParsedCollection, mode: AiAnalysisMode) {
  const chain = getRuleChain(rule, collection).join('\n');
  return `You are a senior SOC detection engineer. Analyze this Wazuh rule for mode=${mode}.\n\nRule ID: ${rule.id}\nLevel: ${rule.level}\nRole: ${rule.role}\nSeverity: ${rule.severity}\nUse case: ${rule.useCaseId} (${ucName(collection, rule.useCaseId)})\nDescription: ${rule.description}\nGroups: ${list(rule.groups)}\nMITRE: ${list(rule.mitre)}\nDependencies: ${JSON.stringify(rule.dependencies)}\nFields: ${rule.fields.map((f) => `${f.name} ${f.type || ''} ${f.value}`).join(' | ')}\nFrequency/timeframe: ${rule.frequency || 'none'} / ${rule.timeframe || 'none'}\nDependency chain:\n${chain}\n\nReturn: plain-English explanation, detection intent, tuning risks, false-positive cases, production readiness, and test recommendations.`;
}
