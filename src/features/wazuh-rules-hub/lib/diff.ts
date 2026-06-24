import type { DecoderRecord, ParsedCollection, RuleRecord, UploadedFile, ValidationIssue } from './types';

export type DiffItem<T = unknown> = {
  key: string;
  before?: T;
  after?: T;
  changes?: string[];
};

export type CollectionDiff = {
  summary: {
    fromName?: string;
    toName?: string;
    rulesAdded: number;
    rulesRemoved: number;
    rulesChanged: number;
    decodersAdded: number;
    decodersRemoved: number;
    decodersChanged: number;
    filesAdded: number;
    filesRemoved: number;
    filesChanged: number;
    useCasesAdded: number;
    useCasesRemoved: number;
    newIssues: number;
    resolvedIssues: number;
    jiraVisibilityChanged: number;
    severityChanged: number;
    mitreChanged: number;
    useCaseChanged: number;
  };
  rules: {
    added: DiffItem<RuleRecord>[];
    removed: DiffItem<RuleRecord>[];
    changed: DiffItem<RuleRecord>[];
  };
  decoders: {
    added: DiffItem<DecoderRecord>[];
    removed: DiffItem<DecoderRecord>[];
    changed: DiffItem<DecoderRecord>[];
  };
  files: {
    added: DiffItem<UploadedFile>[];
    removed: DiffItem<UploadedFile>[];
    changed: DiffItem<UploadedFile>[];
  };
  useCases: {
    added: DiffItem<string>[];
    removed: DiffItem<string>[];
  };
  issues: {
    added: DiffItem<ValidationIssue>[];
    resolved: DiffItem<ValidationIssue>[];
  };
};

const sorted = (values: unknown[]) => values.map(String).sort();
const stable = (value: unknown) => JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
const arrEq = (a: unknown[], b: unknown[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

const depKey = (r: RuleRecord) => sorted(r.dependencies.map((d) => `${d.type}:${d.value}`));
const fieldKey = (r: RuleRecord) => sorted(r.fields.map((f) => `${f.name}:${f.type || ''}:${f.value}`));

const issueKey = (i: ValidationIssue) => [i.severity, i.type, i.ruleId || '', i.decoderName || '', i.fileName || '', i.title, i.detail].join('|');

function mapBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T>();
  for (const item of items) map.set(key(item), item);
  return map;
}

function compareRules(before: RuleRecord, after: RuleRecord) {
  const changes: string[] = [];
  if (before.level !== after.level) changes.push(`level ${before.level} → ${after.level}`);
  if (before.description !== after.description) changes.push('description changed');
  if (before.status !== after.status) changes.push(`status ${before.status} → ${after.status}`);
  if (before.role !== after.role) changes.push(`role ${before.role} → ${after.role}`);
  if (before.severity !== after.severity) changes.push(`severity ${before.severity} → ${after.severity}`);
  if (before.jiraVisible !== after.jiraVisible) changes.push(`jira ${before.jiraVisible ? 'visible' : 'hidden'} → ${after.jiraVisible ? 'visible' : 'hidden'}`);
  if (before.useCaseId !== after.useCaseId) changes.push(`use case ${before.useCaseId} → ${after.useCaseId}`);
  if (!arrEq(before.groups, after.groups)) changes.push('groups changed');
  if (!arrEq(before.mitre, after.mitre)) changes.push('MITRE mapping changed');
  if (!arrEq(depKey(before), depKey(after))) changes.push('dependencies changed');
  if (!arrEq(fieldKey(before), fieldKey(after))) changes.push('fields/conditions changed');
  if (before.frequency !== after.frequency || before.timeframe !== after.timeframe) changes.push(`correlation ${before.frequency || '-'}s/${before.timeframe || '-'}s → ${after.frequency || '-'}s/${after.timeframe || '-'}s`);
  if (!arrEq(before.decodedAs || [], after.decodedAs || [])) changes.push('decoded_as changed');
  if (!arrEq(before.options, after.options)) changes.push('options changed');
  return changes;
}

function compareDecoders(before: DecoderRecord, after: DecoderRecord) {
  const changes: string[] = [];
  if (before.parent !== after.parent) changes.push(`parent ${before.parent || 'none'} → ${after.parent || 'none'}`);
  if (!arrEq(before.prematch || [], after.prematch || [])) changes.push('prematch changed');
  if (!arrEq(before.regex || [], after.regex || [])) changes.push('regex changed');
  if (!arrEq(before.orderFields || [], after.orderFields || [])) changes.push('order fields changed');
  if (before.sourceFile !== after.sourceFile) changes.push(`source file ${before.sourceFile} → ${after.sourceFile}`);
  return changes;
}

export function diffCollections(before: ParsedCollection, after: ParsedCollection, meta?: { fromName?: string; toName?: string }): CollectionDiff {
  const beforeRules = mapBy(before.rules, (r) => r.id);
  const afterRules = mapBy(after.rules, (r) => r.id);
  const rulesAdded: DiffItem<RuleRecord>[] = [];
  const rulesRemoved: DiffItem<RuleRecord>[] = [];
  const rulesChanged: DiffItem<RuleRecord>[] = [];

  for (const [id, rule] of afterRules) if (!beforeRules.has(id)) rulesAdded.push({ key: id, after: rule });
  for (const [id, rule] of beforeRules) if (!afterRules.has(id)) rulesRemoved.push({ key: id, before: rule });
  for (const [id, afterRule] of afterRules) {
    const beforeRule = beforeRules.get(id);
    if (!beforeRule) continue;
    const changes = compareRules(beforeRule, afterRule);
    if (changes.length) rulesChanged.push({ key: id, before: beforeRule, after: afterRule, changes });
  }

  const beforeDecoders = mapBy(before.decoders, (d) => d.name);
  const afterDecoders = mapBy(after.decoders, (d) => d.name);
  const decodersAdded: DiffItem<DecoderRecord>[] = [];
  const decodersRemoved: DiffItem<DecoderRecord>[] = [];
  const decodersChanged: DiffItem<DecoderRecord>[] = [];
  for (const [name, decoder] of afterDecoders) if (!beforeDecoders.has(name)) decodersAdded.push({ key: name, after: decoder });
  for (const [name, decoder] of beforeDecoders) if (!afterDecoders.has(name)) decodersRemoved.push({ key: name, before: decoder });
  for (const [name, afterDecoder] of afterDecoders) {
    const beforeDecoder = beforeDecoders.get(name);
    if (!beforeDecoder) continue;
    const changes = compareDecoders(beforeDecoder, afterDecoder);
    if (changes.length) decodersChanged.push({ key: name, before: beforeDecoder, after: afterDecoder, changes });
  }

  const beforeFiles = mapBy(before.files, (f) => f.name);
  const afterFiles = mapBy(after.files, (f) => f.name);
  const filesAdded: DiffItem<UploadedFile>[] = [];
  const filesRemoved: DiffItem<UploadedFile>[] = [];
  const filesChanged: DiffItem<UploadedFile>[] = [];
  for (const [name, file] of afterFiles) if (!beforeFiles.has(name)) filesAdded.push({ key: name, after: file });
  for (const [name, file] of beforeFiles) if (!afterFiles.has(name)) filesRemoved.push({ key: name, before: file });
  for (const [name, afterFile] of afterFiles) {
    const beforeFile = beforeFiles.get(name);
    if (!beforeFile) continue;
    const changes: string[] = [];
    if (beforeFile.hash !== afterFile.hash) changes.push('sha256/content changed');
    if (beforeFile.type !== afterFile.type) changes.push(`type ${beforeFile.type} → ${afterFile.type}`);
    if (beforeFile.size !== afterFile.size) changes.push(`size ${beforeFile.size} → ${afterFile.size}`);
    if (changes.length) filesChanged.push({ key: name, before: beforeFile, after: afterFile, changes });
  }

  const beforeUseCases = new Set(before.rules.map((r) => r.useCaseId).filter(Boolean));
  const afterUseCases = new Set(after.rules.map((r) => r.useCaseId).filter(Boolean));
  const useCasesAdded = [...afterUseCases].filter((id) => !beforeUseCases.has(id)).map((id) => ({ key: id, after: id }));
  const useCasesRemoved = [...beforeUseCases].filter((id) => !afterUseCases.has(id)).map((id) => ({ key: id, before: id }));

  const beforeIssues = mapBy(before.issues, issueKey);
  const afterIssues = mapBy(after.issues, issueKey);
  const newIssues = [...afterIssues.entries()].filter(([key]) => !beforeIssues.has(key)).map(([key, issue]) => ({ key, after: issue }));
  const resolvedIssues = [...beforeIssues.entries()].filter(([key]) => !afterIssues.has(key)).map(([key, issue]) => ({ key, before: issue }));

  const jiraVisibilityChanged = rulesChanged.filter((r) => r.changes?.some((c) => c.startsWith('jira '))).length;
  const severityChanged = rulesChanged.filter((r) => r.changes?.some((c) => c.startsWith('severity '))).length;
  const mitreChanged = rulesChanged.filter((r) => r.changes?.includes('MITRE mapping changed')).length;
  const useCaseChanged = rulesChanged.filter((r) => r.changes?.some((c) => c.startsWith('use case '))).length;

  return {
    summary: {
      fromName: meta?.fromName,
      toName: meta?.toName,
      rulesAdded: rulesAdded.length,
      rulesRemoved: rulesRemoved.length,
      rulesChanged: rulesChanged.length,
      decodersAdded: decodersAdded.length,
      decodersRemoved: decodersRemoved.length,
      decodersChanged: decodersChanged.length,
      filesAdded: filesAdded.length,
      filesRemoved: filesRemoved.length,
      filesChanged: filesChanged.length,
      useCasesAdded: useCasesAdded.length,
      useCasesRemoved: useCasesRemoved.length,
      newIssues: newIssues.length,
      resolvedIssues: resolvedIssues.length,
      jiraVisibilityChanged,
      severityChanged,
      mitreChanged,
      useCaseChanged,
    },
    rules: { added: rulesAdded, removed: rulesRemoved, changed: rulesChanged },
    decoders: { added: decodersAdded, removed: decodersRemoved, changed: decodersChanged },
    files: { added: filesAdded, removed: filesRemoved, changed: filesChanged },
    useCases: { added: useCasesAdded, removed: useCasesRemoved },
    issues: { added: newIssues, resolved: resolvedIssues },
  };
}
