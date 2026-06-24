import type { DecoderRecord, ParsedCollection, RuleRecord } from './types';

export type FieldCriticality = 'critical' | 'high' | 'medium' | 'low';
export type FieldHealth = 'healthy' | 'underused' | 'unknown_source' | 'alias_candidate' | 'orphaned';

export type FieldAliasHint = {
  field: string;
  alias: string;
  reason: string;
};

export type FieldDictionaryEntry = {
  field: string;
  canonical: string;
  family: string;
  description: string;
  aliases: string[];
  risk: FieldCriticality;
};

export type FieldLineageRow = {
  field: string;
  canonical: string;
  family: string;
  description: string;
  aliases: string[];
  producedBy: string[];
  usedByRules: RuleRecord[];
  usedByUseCases: string[];
  jiraVisibleRules: number;
  criticalRules: number;
  decodedAsRules: string[];
  health: FieldHealth;
  criticality: FieldCriticality;
  riskScore: number;
  aliasHints: FieldAliasHint[];
};

export type FieldIntelligenceSummary = {
  rows: FieldLineageRow[];
  stats: {
    totalFields: number;
    producedFields: number;
    usedFields: number;
    unknownSourceFields: number;
    orphanedProducedFields: number;
    aliasCandidates: number;
    criticalFields: number;
    averageRisk: number;
  };
  aliasHints: FieldAliasHint[];
  dictionary: FieldDictionaryEntry[];
};

const uniq = <T,>(items: T[]) => [...new Set(items.filter(Boolean))];
const avg = (items: number[]) => items.length ? Math.round(items.reduce((a, b) => a + b, 0) / items.length) : 0;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const DICTIONARY: FieldDictionaryEntry[] = [
  { field: 'event.action', canonical: 'event.action', family: 'event', description: 'Normalized action/outcome label used by many Wazuh rules.', aliases: ['action', 'fortigate.action'], risk: 'critical' },
  { field: 'event.category', canonical: 'event.category', family: 'event', description: 'Normalized event category such as traffic, vpn, system, dns, ips, webfilter.', aliases: ['type', 'subtype', 'fortigate.type'], risk: 'high' },
  { field: 'event.type', canonical: 'event.type', family: 'event', description: 'Event type/subtype selector used for base helpers and domain helpers.', aliases: ['type', 'event.category', 'fortigate.type'], risk: 'high' },
  { field: 'event.name', canonical: 'event.name', family: 'event', description: 'Normalized event/log description, often derived from logdesc or message text.', aliases: ['logdesc', 'msg', 'message'], risk: 'high' },
  { field: 'event.reason', canonical: 'event.reason', family: 'event', description: 'Reason/outcome explanation, useful for failed login and policy decisions.', aliases: ['reason', 'fortigate.reason'], risk: 'medium' },
  { field: 'fortigate.status', canonical: 'fortigate.status', family: 'fortigate', description: 'FortiGate status/result field for success/failure/error semantics.', aliases: ['status', 'event.outcome'], risk: 'critical' },
  { field: 'fortigate.config.path', canonical: 'fortigate.config.path', family: 'config', description: 'FortiGate configuration path/object family changed by an administrator.', aliases: ['cfgpath', 'config.path'], risk: 'critical' },
  { field: 'fortigate.config.attr', canonical: 'fortigate.config.attr', family: 'config', description: 'Configuration attribute delta, often the most important config-change context.', aliases: ['cfgattr', 'fortigate.config.attribute'], risk: 'critical' },
  { field: 'fortigate.ui', canonical: 'fortigate.ui', family: 'admin', description: 'Administrative access channel such as HTTPS, SSH, console, Telnet, or HTTP.', aliases: ['ui', 'admin_ui'], risk: 'high' },
  { field: 'user.target', canonical: 'user.target', family: 'identity', description: 'Target/subject user account involved in authentication or admin actions.', aliases: ['user', 'xauthuser', 'admin', 'username'], risk: 'critical' },
  { field: 'source.ip', canonical: 'source.ip', family: 'network', description: 'Normalized source IP address.', aliases: ['srcip', 'src', 'source.address', 'fortigate.vpn.remote_ip'], risk: 'critical' },
  { field: 'destination.ip', canonical: 'destination.ip', family: 'network', description: 'Normalized destination IP address.', aliases: ['dstip', 'dst', 'destination.address'], risk: 'critical' },
  { field: 'source.port', canonical: 'source.port', family: 'network', description: 'Normalized source port.', aliases: ['srcport', 'src_port'], risk: 'medium' },
  { field: 'destination.port', canonical: 'destination.port', family: 'network', description: 'Normalized destination port.', aliases: ['dstport', 'dst_port'], risk: 'high' },
  { field: 'rule.id', canonical: 'rule.id', family: 'policy', description: 'Firewall policy/rule ID used for policy tracking and risky policy detection.', aliases: ['policyid', 'policy.id'], risk: 'high' },
  { field: 'hostname', canonical: 'hostname', family: 'web', description: 'Destination hostname / web host involved in webfilter or DNS activity.', aliases: ['host', 'destination.domain', 'url.domain'], risk: 'high' },
  { field: 'url', canonical: 'url', family: 'web', description: 'URL path/full URL used by webfilter, malware, or C2 detections.', aliases: ['request.url', 'web.url'], risk: 'high' },
  { field: 'file.name', canonical: 'file.name', family: 'file', description: 'File name observed by AV/file security rules.', aliases: ['filename', 'fname'], risk: 'high' },
  { field: 'fortigate.attack.name', canonical: 'fortigate.attack.name', family: 'threat', description: 'IPS/anomaly attack signature name.', aliases: ['attack', 'attack.name'], risk: 'critical' },
  { field: 'fortigate.threat.name', canonical: 'fortigate.threat.name', family: 'threat', description: 'Antivirus/threat name or family.', aliases: ['virus', 'threat', 'malware.name'], risk: 'critical' },
  { field: 'fortigate.vpn.remote_ip', canonical: 'fortigate.vpn.remote_ip', family: 'vpn', description: 'Remote VPN peer/source IP, key for VPN brute-force correlation.', aliases: ['remip', 'source.ip'], risk: 'critical' },
  { field: 'fortigate.vpn.tunnel_ip', canonical: 'fortigate.vpn.tunnel_ip', family: 'vpn', description: 'Assigned VPN tunnel IP.', aliases: ['tunnelip', 'assignip'], risk: 'medium' },
  { field: 'destination.bytes', canonical: 'destination.bytes', family: 'traffic', description: 'Bytes received/inbound to destination side.', aliases: ['rcvdbyte', 'rcvd', 'destination.bytes'], risk: 'medium' },
  { field: 'source.bytes', canonical: 'source.bytes', family: 'traffic', description: 'Bytes sent/outbound from source side.', aliases: ['sentbyte', 'sent', 'source.bytes'], risk: 'high' },
];

function normalizeField(field: string): string {
  return (field || '').trim().replace(/^data\./, '').replace(/^fortigate\./, 'fortigate.');
}

function dictionaryFor(field: string): FieldDictionaryEntry {
  const normalized = normalizeField(field).toLowerCase();
  const direct = DICTIONARY.find((d) => d.field.toLowerCase() === normalized || d.aliases.some((a) => a.toLowerCase() === normalized));
  if (direct) return direct;
  const family = normalized.includes('ip') || normalized.includes('port') ? 'network'
    : normalized.includes('vpn') ? 'vpn'
    : normalized.includes('config') || normalized.includes('cfg') ? 'config'
    : normalized.includes('user') ? 'identity'
    : normalized.includes('url') || normalized.includes('host') ? 'web'
    : normalized.includes('attack') || normalized.includes('threat') || normalized.includes('virus') ? 'threat'
    : 'custom';
  return { field, canonical: field, family, description: 'Custom or product-specific field not present in the built-in dictionary.', aliases: [], risk: family === 'threat' || family === 'config' ? 'high' : 'medium' };
}

function criticalityScore(level: FieldCriticality) {
  return level === 'critical' ? 35 : level === 'high' ? 26 : level === 'medium' ? 16 : 8;
}

function buildAliasHints(fields: string[]): FieldAliasHint[] {
  const set = new Set(fields.map((f) => f.toLowerCase()));
  const hints: FieldAliasHint[] = [];
  DICTIONARY.forEach((entry) => {
    const familyHits = [entry.field, ...entry.aliases].filter((f) => set.has(f.toLowerCase()));
    if (familyHits.length >= 2) {
      familyHits.forEach((field) => {
        if (field !== entry.canonical) hints.push({ field, alias: entry.canonical, reason: `Likely alias of ${entry.canonical}; both forms appear in this ruleset/decoder set.` });
      });
    }
  });
  fields.forEach((field) => {
    const cleaned = field.replace(/^data\./, '');
    if (cleaned !== field && set.has(cleaned.toLowerCase())) {
      hints.push({ field, alias: cleaned, reason: 'Both data-prefixed and canonical/non-prefixed forms appear; normalize carefully.' });
    }
  });
  return uniq(hints.map((h) => `${h.field}=>${h.alias}|${h.reason}`)).map((x) => {
    const [left, reason] = x.split('|');
    const [field, alias] = left.split('=>');
    return { field, alias, reason };
  });
}

function rulesUsingField(rule: RuleRecord, field: string): boolean {
  return rule.fields.some((f) => f.name === field) || rule.dependencies.some((d) => d.type === 'decoded_as' && d.value === field);
}

export function buildFieldIntelligence(collection: ParsedCollection): FieldIntelligenceSummary {
  const producedBy = new Map<string, DecoderRecord[]>();
  collection.decoders.forEach((decoder) => decoder.orderFields.forEach((field) => {
    const key = field.trim();
    if (!key) return;
    producedBy.set(key, [...(producedBy.get(key) || []), decoder]);
  }));

  const usedBy = new Map<string, RuleRecord[]>();
  collection.rules.forEach((rule) => {
    rule.fields.forEach((field) => {
      if (!field.name) return;
      usedBy.set(field.name, [...(usedBy.get(field.name) || []), rule]);
    });
    ['same_field', 'different_field'].forEach((marker) => {
      rule.fields.filter((f) => f.name === marker).forEach((f) => usedBy.set(f.value, [...(usedBy.get(f.value) || []), rule]));
    });
  });

  const decodedAsMap = new Map<string, RuleRecord[]>();
  collection.rules.forEach((rule) => (rule.decodedAs || []).forEach((decoder) => decodedAsMap.set(decoder, [...(decodedAsMap.get(decoder) || []), rule])));

  const allFields = uniq([...producedBy.keys(), ...usedBy.keys()]).sort();
  const aliasHints = buildAliasHints(allFields);
  const aliasByField = new Map<string, FieldAliasHint[]>();
  aliasHints.forEach((hint) => aliasByField.set(hint.field, [...(aliasByField.get(hint.field) || []), hint]));

  const rows = allFields.map((field): FieldLineageRow => {
    const decoders = producedBy.get(field) || [];
    const rules = usedBy.get(field) || [];
    const dict = dictionaryFor(field);
    const jiraVisibleRules = rules.filter((r) => r.jiraVisible).length;
    const criticalRules = rules.filter((r) => r.level >= 12).length;
    const decodedAsRules = uniq(decoders.flatMap((decoder) => decodedAsMap.get(decoder.name) || []).map((r) => r.id));
    const hints = aliasByField.get(field) || [];
    const health: FieldHealth = decoders.length && rules.length ? 'healthy'
      : decoders.length && !rules.length ? 'orphaned'
      : !decoders.length && rules.length ? 'unknown_source'
      : hints.length ? 'alias_candidate'
      : 'underused';
    const riskScore = clamp(
      criticalityScore(dict.risk)
      + Math.min(24, rules.length * 3)
      + Math.min(18, jiraVisibleRules * 6)
      + Math.min(14, criticalRules * 7)
      + (health === 'unknown_source' ? 16 : 0)
      + (health === 'orphaned' ? 8 : 0)
      + (hints.length ? 8 : 0)
    );
    return {
      field,
      canonical: dict.canonical,
      family: dict.family,
      description: dict.description,
      aliases: dict.aliases,
      producedBy: decoders.map((d) => d.name),
      usedByRules: rules,
      usedByUseCases: uniq(rules.map((r) => r.useCaseId)).sort(),
      jiraVisibleRules,
      criticalRules,
      decodedAsRules,
      health,
      criticality: dict.risk,
      riskScore,
      aliasHints: hints,
    };
  }).sort((a, b) => b.riskScore - a.riskScore || b.usedByRules.length - a.usedByRules.length || a.field.localeCompare(b.field));

  const stats = {
    totalFields: rows.length,
    producedFields: [...producedBy.keys()].length,
    usedFields: [...usedBy.keys()].length,
    unknownSourceFields: rows.filter((r) => r.health === 'unknown_source').length,
    orphanedProducedFields: rows.filter((r) => r.health === 'orphaned').length,
    aliasCandidates: aliasHints.length,
    criticalFields: rows.filter((r) => r.criticality === 'critical').length,
    averageRisk: avg(rows.map((r) => r.riskScore)),
  };

  return { rows, stats, aliasHints, dictionary: DICTIONARY };
}

export function fieldIntelligenceMarkdown(summary: FieldIntelligenceSummary): string {
  const lines = [
    '# Field Intelligence Deep Dive',
    '',
    `- Total fields: ${summary.stats.totalFields}`,
    `- Produced fields: ${summary.stats.producedFields}`,
    `- Used fields: ${summary.stats.usedFields}`,
    `- Unknown-source fields: ${summary.stats.unknownSourceFields}`,
    `- Orphaned produced fields: ${summary.stats.orphanedProducedFields}`,
    `- Alias candidates: ${summary.stats.aliasCandidates}`,
    `- Average risk: ${summary.stats.averageRisk}/100`,
    '',
    '## Highest-risk fields',
    '',
    '| Field | Health | Risk | Produced By | Used By Rules | Use Cases |',
    '|---|---:|---:|---|---:|---|',
    ...summary.rows.slice(0, 40).map((r) => `| ${r.field} | ${r.health} | ${r.riskScore} | ${r.producedBy.slice(0, 4).join(', ') || 'none'} | ${r.usedByRules.length} | ${r.usedByUseCases.slice(0, 5).join(', ') || 'none'} |`),
    '',
    '## Alias candidates',
    '',
    ...summary.aliasHints.slice(0, 60).map((h) => `- ${h.field} → ${h.alias}: ${h.reason}`),
  ];
  return lines.join('\n');
}
