import { GROUP_TO_USE_CASE, USE_CASES } from './use-cases';
import type { DecoderRecord, ParsedCollection, RuleDependency, RuleField, RuleRecord, UploadedFile, UseCaseRecord, ValidationIssue } from './types';

const decodeEntities = (value: string) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

const attr = (xml: string, name: string): string | undefined => {
  const m = xml.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
  return m ? decodeEntities(m[1]) : undefined;
};

const tagValues = (xml: string, tag: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1].trim()));
  return out;
};

const tagAttrs = (xml: string, tag: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\s+([^>]*)>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
};

const splitCsv = (value: string | undefined) =>
  (value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const getBlocks = (content: string, tag: 'rule' | 'decoder') => {
  const blocks: string[] = [];
  const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) blocks.push(m[0]);
  return blocks;
};

const inferFileType = (name: string, content: string): UploadedFile['type'] => {
  const lower = `${name}\n${content.slice(0, 2000)}`.toLowerCase();
  if (lower.includes('<decoder') || lower.includes('decoders')) return 'decoders';
  if (lower.includes('<rule') || lower.includes('rules')) return 'rules';
  return 'unknown';
};

const simpleHash = async (text: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const readUploadedFiles = async (fileList: FileList | File[]): Promise<UploadedFile[]> => {
  const files = Array.from(fileList);
  const results: UploadedFile[] = [];
  for (const file of files) {
    const content = await file.text();
    results.push({
      name: file.name,
      size: file.size,
      content,
      type: inferFileType(file.name, content),
      hash: await simpleHash(`${file.name}:${content}`),
    });
  }
  return results;
};

const extractUseCaseFromInfo = (xml: string): string | undefined => {
  const infos = tagValues(xml, 'info');
  for (const info of infos) {
    const m = info.match(/use_case\s*:\s*([a-z0-9_\-.]+)/i);
    if (m) return m[1].trim();
  }
  return undefined;
};

const inferUseCase = (groups: string[], description: string, sourceFile: string): { id: string; confidence: RuleRecord['useCaseConfidence'] } => {
  for (const g of groups) {
    if (GROUP_TO_USE_CASE[g]) return { id: GROUP_TO_USE_CASE[g], confidence: 'inferred' };
    if (g.startsWith('uc_')) return { id: g, confidence: 'confirmed' };
  }
  const hay = `${sourceFile} ${groups.join(' ')} ${description}`.toLowerCase();
  const heuristics: Array<[RegExp, string]> = [
    [/parser|invalid.+field|null|placeholder/, 'uc_fgt_parser_health'],
    [/admin.+auth|administrator.+login|admin.+login/, 'uc_fgt_admin_auth'],
    [/admin.+config|configuration|cfgpath|policy.+changed/, 'uc_fgt_admin_config'],
    [/vpn|ssl-login|remote access|ipsec/, 'uc_fgt_vpn_auth'],
    [/traffic|denied|allowed|policy|network flow/, 'uc_fgt_traffic_policy'],
    [/utm|webfilter|dnsfilter|appcontrol/, 'uc_fgt_utm_security'],
    [/threat intel|reputation|c2|malware_c2/, 'uc_fgt_threat_reputation'],
    [/ips|exploit/, 'uc_fgt_ips_exploit'],
    [/malware|virus|file security/, 'uc_fgt_malware_file'],
    [/dns/, 'uc_fgt_dnsfilter_threat'],
    [/web|url|phish/, 'uc_fgt_webfilter_threat'],
    [/dos|anomaly|scan|flood/, 'uc_fgt_dos_anomaly'],
    [/exposure|weakened|disabled|any-any|allowaccess/, 'uc_fgt_exposure_config'],
    [/ha|cluster|failover/, 'uc_fgt_ha_cluster'],
    [/sdwan|sd-wan|route|routing|bgp/, 'uc_fgt_sdwan_routing'],
  ];
  for (const [re, id] of heuristics) if (re.test(hay)) return { id, confidence: 'inferred' };
  return { id: 'unassigned', confidence: 'unassigned' };
};

const severityFromLevel = (level: number) => {
  if (level <= 0) return 'informational';
  if (level <= 5) return 'low';
  if (level <= 8) return 'medium';
  if (level <= 11) return 'high';
  return 'critical';
};

const roleFromRule = (level: number, xml: string, groups: string[]) => {
  const g = groups.join(' ');
  if (/parser|invalid|null|placeholder/.test(g)) return 'parser_health';
  if (level === 0) return 'helper';
  if (/frequency=|timeframe=|<if_matched_sid>|<if_matched_group>|<same_|<different_/.test(xml)) return 'correlation';
  if (level >= 12) return 'critical';
  return 'detection';
};

const statusFromGroups = (groups: string[]) => {
  const allowed = ['production', 'testing', 'deprecated', 'disabled', 'experimental'];
  return groups.find((g) => allowed.includes(g)) || 'unknown';
};

const sourceSectionFor = (content: string, index: number): string | undefined => {
  const before = content.slice(Math.max(0, index - 5000), index);
  const matches = [...before.matchAll(/Source file:\s*([^<\n]+)/gi)];
  const last = matches.at(-1)?.[1]?.trim();
  return last?.replace(/-->/g, '').trim();
};

const parseRuleBlock = (xml: string, fileName: string, content: string, startIndex: number): RuleRecord | null => {
  const id = attr(xml, 'id');
  if (!id) return null;
  const level = Number(attr(xml, 'level') || 0);
  const description = tagValues(xml, 'description')[0] || `Rule ${id}`;
  const groups = splitCsv(tagValues(xml, 'group').join(','));
  const infoUseCase = extractUseCaseFromInfo(xml);
  const inferred = infoUseCase ? { id: infoUseCase, confidence: 'confirmed' as const } : inferUseCase(groups, description, fileName);
  const dependencies: RuleDependency[] = [];
  for (const sid of splitCsv(tagValues(xml, 'if_sid').join(','))) dependencies.push({ type: 'if_sid', value: sid });
  for (const group of splitCsv(tagValues(xml, 'if_group').join(','))) dependencies.push({ type: 'if_group', value: group });
  for (const sid of splitCsv(tagValues(xml, 'if_matched_sid').join(','))) dependencies.push({ type: 'if_matched_sid', value: sid });
  for (const group of splitCsv(tagValues(xml, 'if_matched_group').join(','))) dependencies.push({ type: 'if_matched_group', value: group });
  const decodedAs = tagValues(xml, 'decoded_as');
  for (const dec of decodedAs) dependencies.push({ type: 'decoded_as', value: dec });

  const fields: RuleField[] = [];
  const fieldRe = /<field\s+([^>]*)>([\s\S]*?)<\/field>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fieldRe.exec(xml))) fields.push({ name: attr(fm[1], 'name') || 'field', type: attr(fm[1], 'type'), value: decodeEntities(fm[2].trim()) });
  for (const m of tagValues(xml, 'match')) fields.push({ name: 'match', type: undefined, value: m });
  for (const m of tagValues(xml, 'same_field')) fields.push({ name: 'same_field', value: m });
  for (const m of tagValues(xml, 'different_field')) fields.push({ name: 'different_field', value: m });

  return {
    id,
    level,
    description,
    groups,
    status: statusFromGroups(groups),
    role: roleFromRule(level, xml, groups),
    severity: severityFromLevel(level),
    jiraVisible: level >= 11,
    sourceFile: fileName,
    sourceSection: sourceSectionFor(content, startIndex),
    useCaseId: inferred.id,
    useCaseConfidence: inferred.confidence,
    mitre: tagValues(xml, 'id').filter((x) => /^T\d{4}(\.\d{3})?$/i.test(x)),
    dependencies,
    fields,
    frequency: attr(xml, 'frequency'),
    timeframe: attr(xml, 'timeframe'),
    decodedAs,
    options: tagValues(xml, 'options'),
    rawXml: xml,
  };
};

const parseRules = (file: UploadedFile): RuleRecord[] => {
  const rules: RuleRecord[] = [];
  const re = /<rule\b[\s\S]*?<\/rule>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(file.content))) {
    const rule = parseRuleBlock(m[0], file.name, file.content, m.index);
    if (rule) rules.push(rule);
  }
  return rules;
};

const parseDecoders = (file: UploadedFile): DecoderRecord[] => {
  return getBlocks(file.content, 'decoder')
    .map((xml) => ({
      name: attr(xml, 'name') || tagValues(xml, 'name')[0] || 'unnamed_decoder',
      parent: tagValues(xml, 'parent')[0],
      prematch: tagValues(xml, 'prematch'),
      regex: tagValues(xml, 'regex'),
      orderFields: tagValues(xml, 'order').flatMap(splitCsv),
      sourceFile: file.name,
      rawXml: xml,
    }))
    .filter((d) => d.name !== 'unnamed_decoder' || d.regex.length || d.parent);
};

const validate = (files: UploadedFile[], rules: RuleRecord[], decoders: DecoderRecord[], useCases: UseCaseRecord[]): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const knownUseCases = new Set(useCases.map((useCase) => useCase.id));
  const idMap = new Map<string, RuleRecord[]>();
  for (const r of rules) idMap.set(r.id, [...(idMap.get(r.id) || []), r]);
  for (const [id, rs] of idMap) if (rs.length > 1) issues.push({ severity: 'error', type: 'duplicate_rule_id', title: `Duplicate rule ID ${id}`, detail: `${rs.length} rules share the same Wazuh rule ID.`, ruleId: id });

  const decoderMap = new Map<string, DecoderRecord[]>();
  for (const d of decoders) decoderMap.set(d.name, [...(decoderMap.get(d.name) || []), d]);
  for (const [name, ds] of decoderMap) if (ds.length > 1) issues.push({ severity: 'warning', type: 'duplicate_decoder_name', title: `Duplicate decoder ${name}`, detail: `${ds.length} decoder blocks share the same decoder name.`, decoderName: name });

  const groupsProduced = new Set<string>();
  rules.forEach((r) => r.groups.forEach((g) => groupsProduced.add(g)));
  const ruleIds = new Set(rules.map((r) => r.id));
  const decoderNames = new Set(decoders.map((d) => d.name));

  for (const r of rules) {
    if (r.useCaseId === 'unassigned') issues.push({ severity: 'warning', type: 'missing_use_case', title: `Rule ${r.id} has no use case`, detail: 'Add <info type="text">use_case:...</info> or extend fallback mappings.', ruleId: r.id, fileName: r.sourceFile });
    if (r.useCaseId !== 'unassigned' && !knownUseCases.has(r.useCaseId)) issues.push({ severity: 'warning', type: 'unknown_use_case_registry', title: `Rule ${r.id} uses unknown use case ${r.useCaseId}`, detail: 'The use_case info tag resolves to an ID that is not registered in the use-case catalog.', ruleId: r.id, fileName: r.sourceFile });
    if (r.jiraVisible && r.mitre.length === 0) issues.push({ severity: 'warning', type: 'jira_without_mitre', title: `Jira-visible rule ${r.id} has no MITRE`, detail: 'Level >= 11 but no MITRE technique was found.', ruleId: r.id });
    if (r.level === 0 && r.mitre.length > 0) issues.push({ severity: 'info', type: 'helper_with_mitre', title: `Helper rule ${r.id} has MITRE`, detail: 'Level 0 helper rules usually should not carry ATT&CK mapping unless intentional.', ruleId: r.id });
    if (r.level > 15) issues.push({ severity: 'warning', type: 'level_above_standard', title: `Rule ${r.id} level is above 15`, detail: `Detected level ${r.level}. Confirm this is accepted by your Wazuh version and workflow.`, ruleId: r.id });
    for (const dep of r.dependencies) {
      if ((dep.type === 'if_sid' || dep.type === 'if_matched_sid') && !ruleIds.has(dep.value)) issues.push({ severity: 'warning', type: 'external_or_missing_sid', title: `Rule ${r.id} references SID ${dep.value}`, detail: 'The SID was not found in uploaded rule files. It may be a stock Wazuh rule or a missing file.', ruleId: r.id });
      if ((dep.type === 'if_group' || dep.type === 'if_matched_group') && !groupsProduced.has(dep.value)) issues.push({ severity: 'warning', type: 'missing_group_dependency', title: `Rule ${r.id} references group ${dep.value}`, detail: 'No uploaded rule produces this group. It may be external, missing, or typo.', ruleId: r.id });
      if (dep.type === 'decoded_as' && !decoderNames.has(dep.value)) issues.push({ severity: 'warning', type: 'missing_decoder', title: `Rule ${r.id} uses decoder ${dep.value}`, detail: 'No uploaded decoder block has this exact decoder name.', ruleId: r.id });
    }
  }

  for (const d of decoders) {
    if (d.parent && !decoderNames.has(d.parent)) issues.push({ severity: 'info', type: 'external_decoder_parent', title: `Decoder ${d.name} parent not uploaded`, detail: `Parent decoder ${d.parent} was not found in uploaded decoder files. It may be stock/built-in or in another file.`, decoderName: d.name });
  }

  for (const f of files) if (f.type === 'unknown') issues.push({ severity: 'info', type: 'unknown_file_type', title: `Unknown file type: ${f.name}`, detail: 'The file did not clearly look like rules or decoders XML.', fileName: f.name });
  return issues;
};

export const parseCollection = (files: UploadedFile[], useCases: UseCaseRecord[] = USE_CASES): ParsedCollection => {
  const rules = files.flatMap(parseRules);
  const decoders = files.flatMap(parseDecoders);
  const issues = validate(files, rules, decoders, useCases);
  const usedUseCases = new Set(rules.map((r) => r.useCaseId).filter((x) => x !== 'unassigned'));
  const activeUseCases = useCases.filter((u) => usedUseCases.has(u.id));
  const brokenDependencies = issues.filter((i) => ['external_or_missing_sid', 'missing_group_dependency', 'missing_decoder'].includes(i.type)).length;
  return {
    files,
    rules,
    decoders,
    useCases: activeUseCases,
    issues,
    stats: {
      rules: rules.length,
      decoders: decoders.length,
      useCases: usedUseCases.size,
      jiraVisible: rules.filter((r) => r.jiraVisible).length,
      testing: rules.filter((r) => r.status === 'testing').length,
      production: rules.filter((r) => r.status === 'production').length,
      critical: rules.filter((r) => r.severity === 'critical').length,
      mitreMapped: rules.filter((r) => r.mitre.length > 0).length,
      missingUseCase: rules.filter((r) => r.useCaseId === 'unassigned').length,
      brokenDependencies,
    },
  };
};
