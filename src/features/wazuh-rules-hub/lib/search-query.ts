import type { DecoderRecord, ParsedCollection, RuleRecord, UploadedFile, ValidationIssue } from './types';

export type SearchBucket = 'rules' | 'decoders' | 'files' | 'issues';
export type SearchFilters = {
  collectionId?: string;
  bucket?: 'all' | SearchBucket;
  status?: string;
  role?: string;
  useCaseId?: string;
  severity?: string;
  jira?: string;
  mitre?: string;
  sourceFile?: string;
};

export type ParsedSearchQuery = {
  text: string[];
  tokens: Record<string, string[]>;
  negatives: string[];
};

const FIELD_ALIASES: Record<string, string> = {
  id: 'id', sid: 'id', rule: 'id', ruleid: 'id', level: 'level', status: 'status', role: 'role',
  usecase: 'usecase', uc: 'usecase', mitre: 'mitre', group: 'group', decoder: 'decoder', field: 'field',
  jira: 'jira', severity: 'severity', file: 'file', source: 'file', type: 'type', kind: 'type',
};

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const parts = input.match(/"[^"]+"|\S+/g) || [];
  const parsed: ParsedSearchQuery = { text: [], tokens: {}, negatives: [] };
  for (const raw of parts) {
    const value = raw.replace(/^"|"$/g, '');
    if (!value) continue;
    if (value.startsWith('-')) { parsed.negatives.push(value.slice(1).toLowerCase()); continue; }
    const idx = value.indexOf(':');
    if (idx > 0) {
      const key = FIELD_ALIASES[value.slice(0, idx).toLowerCase()] || value.slice(0, idx).toLowerCase();
      const token = value.slice(idx + 1).toLowerCase();
      if (token) parsed.tokens[key] = [...(parsed.tokens[key] || []), token];
    } else parsed.text.push(value.toLowerCase());
  }
  return parsed;
}

const includes = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());
const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];

export function searchableRule(r: RuleRecord) {
  return `${r.id} ${r.level} ${r.description} ${r.status} ${r.role} ${r.severity} ${r.useCaseId} ${r.useCaseConfidence} ${r.sourceFile} ${r.sourceSection || ''} ${r.groups.join(' ')} ${r.mitre.join(' ')} ${(r.decodedAs || []).join(' ')} ${r.dependencies.map(d=>`${d.type}:${d.value}`).join(' ')} ${r.fields.map(f=>`${f.name} ${f.type} ${f.value}`).join(' ')}`;
}
export function searchableDecoder(d: DecoderRecord) {
  return `${d.name} ${d.parent || ''} ${d.sourceFile} ${(d.prematch || []).join(' ')} ${d.regex.join(' ')} ${d.orderFields.join(' ')} ${d.rawXml}`;
}
export function searchableFile(f: UploadedFile) { return `${f.name} ${f.type} ${f.hash} ${f.content.slice(0, 2500)}`; }
export function searchableIssue(i: ValidationIssue) { return `${i.severity} ${i.type} ${i.title} ${i.detail} ${i.ruleId || ''} ${i.decoderName || ''} ${i.fileName || ''}`; }

function tokenMatchRule(r: RuleRecord, key: string, val: string) {
  if (key === 'id') return includes(r.id, val);
  if (key === 'level') return String(r.level) === val || (val.startsWith('>=') && r.level >= Number(val.slice(2))) || (val.startsWith('<=') && r.level <= Number(val.slice(2)));
  if (key === 'status') return includes(r.status, val);
  if (key === 'role') return includes(r.role, val);
  if (key === 'usecase') return includes(r.useCaseId, val);
  if (key === 'mitre') return r.mitre.some(m => includes(m, val));
  if (key === 'group') return r.groups.some(g => includes(g, val));
  if (key === 'decoder') return (r.decodedAs || []).some(d => includes(d, val));
  if (key === 'field') return r.fields.some(f => includes(f.name, val) || includes(f.value, val));
  if (key === 'jira') return String(r.jiraVisible) === val || (val === 'visible' && r.jiraVisible) || (val === 'hidden' && !r.jiraVisible);
  if (key === 'severity') return includes(r.severity, val);
  if (key === 'file') return includes(r.sourceFile, val);
  if (key === 'type') return val === 'rule' || val === 'rules';
  return includes(searchableRule(r), `${key}:${val}`) || includes(searchableRule(r), val);
}
function tokenMatchDecoder(d: DecoderRecord, key: string, val: string) {
  if (key === 'id' || key === 'decoder') return includes(d.name, val);
  if (key === 'field') return d.orderFields.some(f => includes(f, val));
  if (key === 'file') return includes(d.sourceFile, val);
  if (key === 'type') return val === 'decoder' || val === 'decoders';
  return includes(searchableDecoder(d), val);
}

export function searchParsedCollection(data: ParsedCollection, query: string, filters: SearchFilters = {}) {
  const parsed = parseSearchQuery(query);
  const textMatch = (hay: string) => parsed.text.every(t => includes(hay, t)) && parsed.negatives.every(n => !includes(hay, n));
  const tokenMatch = (kind: SearchBucket, item: RuleRecord | DecoderRecord | UploadedFile | ValidationIssue) => Object.entries(parsed.tokens).every(([key, vals]) => vals.every((val) => {
    if (kind === 'rules') return tokenMatchRule(item as RuleRecord, key, val);
    if (kind === 'decoders') return tokenMatchDecoder(item as DecoderRecord, key, val);
    return includes(kind === 'files' ? searchableFile(item as UploadedFile) : searchableIssue(item as ValidationIssue), val);
  }));
  const bucket = filters.bucket || 'all';
  const rules = bucket === 'all' || bucket === 'rules' ? data.rules.filter(r =>
    (!filters.status || filters.status === 'all' || r.status === filters.status) &&
    (!filters.role || filters.role === 'all' || r.role === filters.role) &&
    (!filters.useCaseId || filters.useCaseId === 'all' || r.useCaseId === filters.useCaseId) &&
    (!filters.severity || filters.severity === 'all' || r.severity === filters.severity) &&
    (!filters.jira || filters.jira === 'all' || String(r.jiraVisible) === filters.jira) &&
    (!filters.mitre || r.mitre.some(m => includes(m, filters.mitre!))) &&
    textMatch(searchableRule(r)) && tokenMatch('rules', r)
  ) : [];
  const decoders = bucket === 'all' || bucket === 'decoders' ? data.decoders.filter(d => textMatch(searchableDecoder(d)) && tokenMatch('decoders', d)) : [];
  const files = bucket === 'all' || bucket === 'files' ? data.files.filter(f => textMatch(searchableFile(f)) && tokenMatch('files', f)) : [];
  const issues = bucket === 'all' || bucket === 'issues' ? data.issues.filter(i => textMatch(searchableIssue(i)) && tokenMatch('issues', i)) : [];
  return { parsed, rules, decoders, files, issues, summary: { rules: rules.length, decoders: decoders.length, files: files.length, issues: issues.length } };
}
