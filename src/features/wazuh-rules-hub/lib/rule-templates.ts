import type { ParsedCollection, RuleRecord } from './types';

export type RuleTemplateKind = 'detection' | 'correlation' | 'helper' | 'parser_health' | 'escalation';

export type RuleTemplate = {
  id: string;
  name: string;
  shortName: string;
  kind: RuleTemplateKind;
  vendor: string;
  productGroup: string;
  useCaseId: string;
  level: number;
  description: string;
  dependencyType: 'none' | 'if_sid' | 'if_group' | 'if_matched_sid' | 'if_matched_group' | 'decoded_as';
  dependencyValue: string;
  fieldName?: string;
  fieldType?: string;
  fieldPattern?: string;
  frequency?: string;
  timeframe?: string;
  sameField?: string;
  mitre: string[];
  groups: string[];
  qaPositiveHint: string;
  qaNegativeHint: string;
  notes: string;
};

export type RuleTemplateDraft = {
  templateId: string;
  ruleId: string;
  level: number;
  description: string;
  useCaseId: string;
  status: string;
  productGroup: string;
  dependencyType: RuleTemplate['dependencyType'];
  dependencyValue: string;
  fieldName: string;
  fieldType: string;
  fieldPattern: string;
  frequency: string;
  timeframe: string;
  sameField: string;
  mitre: string[];
  extraGroups: string[];
  sourceRuleId?: string;
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'tpl_fgt_admin_failed_login',
    name: 'FortiGate Admin Failed Login Detection',
    shortName: 'Admin failed login',
    kind: 'detection',
    vendor: 'fortigate',
    productGroup: 'fortigate_admin_auth',
    useCaseId: 'uc_fgt_admin_auth',
    level: 7,
    description: 'FortiGate administrator login failed',
    dependencyType: 'if_sid',
    dependencyValue: '45092',
    fieldName: 'fortigate.status',
    fieldType: 'pcre2',
    fieldPattern: '(?i)^failed$|^failure$|^error$',
    mitre: ['T1078'],
    groups: ['fortigate_admin_failed', 'authentication_failed', 'invalid_login'],
    qaPositiveHint: 'Use an admin login failed event with status=failed and an admin username.',
    qaNegativeHint: 'Use an admin login successful event or a non-admin event.',
    notes: 'Good base detection for admin-auth chains. Correlation templates can depend on group fortigate_admin_failed.',
  },
  {
    id: 'tpl_fgt_admin_bruteforce_same_user',
    name: 'FortiGate Admin Brute Force Correlation - Same User',
    shortName: 'Admin brute force',
    kind: 'correlation',
    vendor: 'fortigate',
    productGroup: 'fortigate_admin_auth',
    useCaseId: 'uc_fgt_admin_auth',
    level: 11,
    description: 'FortiGate repeated administrator login failures for same user',
    dependencyType: 'if_matched_group',
    dependencyValue: 'fortigate_admin_failed',
    frequency: '5',
    timeframe: '300',
    sameField: 'user.target',
    mitre: ['T1110'],
    groups: ['fortigate_admin_bruteforce', 'authentication_failures', 'admin_access'],
    qaPositiveHint: 'Replay 5 failed admin logins for the same user within 300 seconds.',
    qaNegativeHint: 'Replay fewer than 5 failures or failures for different users.',
    notes: 'Use this when Jira should receive repeated admin authentication failure incidents.',
  },
  {
    id: 'tpl_fgt_vpn_failed_login',
    name: 'FortiGate SSL VPN Failed Login Detection',
    shortName: 'VPN failed login',
    kind: 'detection',
    vendor: 'fortigate',
    productGroup: 'fortigate_vpn_auth',
    useCaseId: 'uc_fgt_vpn_auth',
    level: 7,
    description: 'FortiGate SSL VPN login failed',
    dependencyType: 'if_sid',
    dependencyValue: '45030,45084',
    fieldName: 'event.action',
    fieldType: 'pcre2',
    fieldPattern: '(?i)^ssl-login-fail$|^login-fail$|^tunnel-login-fail$',
    mitre: ['T1110', 'T1133'],
    groups: ['fortigate_vpn_failed', 'authentication_failed', 'remote_access'],
    qaPositiveHint: 'Use an SSL VPN login failure log with action=ssl-login-fail and status=failed.',
    qaNegativeHint: 'Use a tunnel-up or logout VPN event.',
    notes: 'Useful base detection for VPN brute-force correlation chains.',
  },
  {
    id: 'tpl_fgt_vpn_bruteforce_source',
    name: 'FortiGate VPN Brute Force Correlation - Same Remote IP',
    shortName: 'VPN source brute force',
    kind: 'correlation',
    vendor: 'fortigate',
    productGroup: 'fortigate_vpn_auth',
    useCaseId: 'uc_fgt_vpn_auth',
    level: 11,
    description: 'FortiGate repeated VPN login failures from same remote IP',
    dependencyType: 'if_matched_group',
    dependencyValue: 'fortigate_vpn_failed',
    frequency: '4',
    timeframe: '300',
    sameField: 'fortigate.vpn.remote_ip',
    mitre: ['T1110', 'T1133'],
    groups: ['fortigate_vpn_source_bruteforce', 'authentication_failures', 'remote_access'],
    qaPositiveHint: 'Replay 4 failed VPN logins from the same remote IP within 300 seconds.',
    qaNegativeHint: 'Replay failures from different remote IPs or fewer than threshold.',
    notes: 'High-value correlation when remote IP field is decoded reliably.',
  },
  {
    id: 'tpl_fgt_config_weakened',
    name: 'FortiGate Security Inspection Weakened',
    shortName: 'Security weakened',
    kind: 'escalation',
    vendor: 'fortigate',
    productGroup: 'fortigate_admin_config',
    useCaseId: 'uc_fgt_admin_config',
    level: 12,
    description: 'FortiGate logging or security inspection may have been weakened',
    dependencyType: 'if_sid',
    dependencyValue: '45340',
    fieldName: 'fortigate.config.attr',
    fieldType: 'pcre2',
    fieldPattern: '(?i)status.*disable|inspection-mode|logtraffic.*disable|utm-status.*disable|av-profile|ips-sensor|webfilter-profile|dnsfilter-profile|application-list',
    mitre: ['T1562'],
    groups: ['fortigate_security_weakened', 'defense_evasion', 'security_profile_change'],
    qaPositiveHint: 'Use a config change log disabling logging, UTM status, or an inspection/security profile.',
    qaNegativeHint: 'Use a benign object edit that does not weaken inspection/logging.',
    notes: 'Good high-priority rule for defense-evasion style firewall changes.',
  },
  {
    id: 'tpl_fgt_web_c2_repeated',
    name: 'FortiGate Repeated C2/Malicious WebFilter Indicators',
    shortName: 'Repeated C2 web',
    kind: 'correlation',
    vendor: 'fortigate',
    productGroup: 'fortigate_webfilter_threat',
    useCaseId: 'uc_fgt_webfilter_threat',
    level: 12,
    description: 'FortiGate repeated malware C2 or malicious web indicators from same source IP',
    dependencyType: 'if_matched_group',
    dependencyValue: 'malware_c2',
    frequency: '3',
    timeframe: '600',
    sameField: 'srcip',
    mitre: ['T1102', 'T1071'],
    groups: ['repeated_c2_web_source', 'c2_web', 'malware_c2', 'web_threat_burst'],
    qaPositiveHint: 'Replay multiple webfilter/C2 hits from the same source IP.',
    qaNegativeHint: 'Replay normal blocked web categories or single low-risk blocks.',
    notes: 'Good template for high-signal web threat bursts.',
  },
  {
    id: 'tpl_fgt_ips_exploit_burst',
    name: 'FortiGate Repeated IPS Exploit Attempts',
    shortName: 'IPS exploit burst',
    kind: 'correlation',
    vendor: 'fortigate',
    productGroup: 'fortigate_ips_exploit',
    useCaseId: 'uc_fgt_ips_exploit',
    level: 12,
    description: 'FortiGate repeated IPS exploit attempts from same source IP',
    dependencyType: 'if_matched_group',
    dependencyValue: 'fortigate_ips_exploit',
    frequency: '4',
    timeframe: '300',
    sameField: 'srcip',
    mitre: ['T1190'],
    groups: ['repeated_exploit_source', 'exploit_burst'],
    qaPositiveHint: 'Replay 4 IPS exploit logs from same source IP within 300 seconds.',
    qaNegativeHint: 'Replay low-severity IPS informational events or fewer than threshold.',
    notes: 'Best when base IPS exploit group already filters meaningful signatures.',
  },
  {
    id: 'tpl_fgt_malware_file_burst',
    name: 'FortiGate Repeated Malware File Blocks',
    shortName: 'Malware file burst',
    kind: 'correlation',
    vendor: 'fortigate',
    productGroup: 'fortigate_malware_file',
    useCaseId: 'uc_fgt_malware_file',
    level: 12,
    description: 'FortiGate repeated malware file blocks from same source IP',
    dependencyType: 'if_matched_group',
    dependencyValue: 'fortigate_malware_file',
    frequency: '4',
    timeframe: '300',
    sameField: 'srcip',
    mitre: ['T1204'],
    groups: ['repeated_malware_source', 'malware_burst'],
    qaPositiveHint: 'Replay multiple antivirus/file infected logs from same source IP.',
    qaNegativeHint: 'Replay clean file transfer logs or only one malware event.',
    notes: 'Good for endpoint/user follow-up when multiple blocked malware events occur.',
  },
  {
    id: 'tpl_fgt_kv_helper',
    name: 'FortiGate KV Helper Base',
    shortName: 'KV helper base',
    kind: 'helper',
    vendor: 'fortigate',
    productGroup: 'fortigate_foundation',
    useCaseId: 'uc_fgt_foundation',
    level: 0,
    description: 'FortiGate KV decoded event compatibility helper',
    dependencyType: 'decoded_as',
    dependencyValue: 'fortigate-firewall-v5',
    fieldName: 'event.type',
    fieldType: 'pcre2',
    fieldPattern: '.+',
    mitre: [],
    groups: ['fortigate_decoded', 'fortigate_kv', 'fortigate_compat_base'],
    qaPositiveHint: 'Use any decoded FortiGate KV event with event.type present.',
    qaNegativeHint: 'Use a non-FortiGate event.',
    notes: 'Helper/base rules should remain level 0 and no_full_log.',
  },
  {
    id: 'tpl_fgt_parser_invalid_user',
    name: 'FortiGate Parser Health - Invalid User',
    shortName: 'Parser invalid user',
    kind: 'parser_health',
    vendor: 'fortigate',
    productGroup: 'fortigate_parser_health',
    useCaseId: 'uc_fgt_parser_health',
    level: 4,
    description: 'FortiGate VPN event parsed with invalid user value',
    dependencyType: 'if_sid',
    dependencyValue: '45030,45031,45032',
    fieldName: 'user.target',
    fieldType: 'pcre2',
    fieldPattern: '(?i)^(\\(null\\)|null|none|n/a|unknown|undefined|-)$',
    mitre: [],
    groups: ['fortigate_vpn', 'parser_invalid_user'],
    qaPositiveHint: 'Use a VPN event where decoded user.target is null/unknown/undefined.',
    qaNegativeHint: 'Use a VPN event with a valid username.',
    notes: 'Parser health rules are dashboard-visible but usually not Jira-visible.',
  },
];

export function suggestNextRuleId(collection: ParsedCollection, preferredStart = 100000): string {
  const used = new Set(collection.rules.map((rule) => rule.id));
  const numeric = collection.rules.map((rule) => Number(rule.id)).filter((value) => Number.isFinite(value));
  const base = Math.max(preferredStart, numeric.length ? Math.max(...numeric) + 1 : preferredStart);
  for (let candidate = base; candidate < base + 5000; candidate++) {
    if (!used.has(String(candidate))) return String(candidate);
  }
  return String(base);
}

export function draftFromTemplate(template: RuleTemplate, collection: ParsedCollection, override?: Partial<RuleTemplateDraft>): RuleTemplateDraft {
  return {
    templateId: template.id,
    ruleId: override?.ruleId || suggestNextRuleId(collection),
    level: override?.level ?? template.level,
    description: override?.description || template.description,
    useCaseId: override?.useCaseId || template.useCaseId,
    status: override?.status || 'testing',
    productGroup: override?.productGroup || template.productGroup,
    dependencyType: override?.dependencyType || template.dependencyType,
    dependencyValue: override?.dependencyValue ?? template.dependencyValue,
    fieldName: override?.fieldName ?? template.fieldName ?? '',
    fieldType: override?.fieldType ?? template.fieldType ?? 'pcre2',
    fieldPattern: override?.fieldPattern ?? template.fieldPattern ?? '',
    frequency: override?.frequency ?? template.frequency ?? '',
    timeframe: override?.timeframe ?? template.timeframe ?? '',
    sameField: override?.sameField ?? template.sameField ?? '',
    mitre: override?.mitre || template.mitre,
    extraGroups: override?.extraGroups || template.groups,
    sourceRuleId: override?.sourceRuleId,
  };
}

export function draftFromExistingRule(rule: RuleRecord, collection: ParsedCollection): RuleTemplateDraft {
  const firstField = rule.fields.find((field) => field.name && !field.name.startsWith('if_')) || rule.fields[0];
  const dependency = rule.dependencies[0];
  return {
    templateId: 'clone_existing_rule',
    ruleId: suggestNextRuleId(collection, Number(rule.id) + 1 || 100000),
    level: rule.level,
    description: `${rule.description} - variant`,
    useCaseId: rule.useCaseId && rule.useCaseId !== 'unassigned' ? rule.useCaseId : 'uc_fgt_custom_detection',
    status: rule.status || 'testing',
    productGroup: rule.groups.find((group) => group.startsWith('fortigate_')) || 'fortigate_custom',
    dependencyType: dependency?.type || 'none',
    dependencyValue: dependency?.value || '',
    fieldName: firstField?.name || '',
    fieldType: firstField?.type || 'pcre2',
    fieldPattern: firstField?.value || '',
    frequency: rule.frequency || '',
    timeframe: rule.timeframe || '',
    sameField: rule.fields.find((field) => field.name === 'same_field')?.value || '',
    mitre: rule.mitre,
    extraGroups: rule.groups.filter((group) => !['testing', 'production', 'experimental', 'deprecated', 'disabled'].includes(group)).slice(0, 8),
    sourceRuleId: rule.id,
  };
}

export function inferRoleFromDraft(draft: RuleTemplateDraft): string {
  if (draft.frequency || draft.timeframe || draft.dependencyType.includes('matched')) return 'correlation';
  if (draft.level === 0) return 'helper';
  if (draft.level >= 12) return 'escalation';
  if (draft.templateId.includes('parser') || draft.productGroup.includes('parser')) return 'parser_health';
  return 'detection';
}

export function buildRuleXmlFromDraft(draft: RuleTemplateDraft): string {
  const role = inferRoleFromDraft(draft);
  const jira = draft.level >= 11 ? 'jira_visible' : 'jira_hidden';
  const groups = [draft.status, draft.productGroup, draft.useCaseId, `role_${role}`, jira, ...draft.extraGroups.map((group) => group.trim()).filter(Boolean)];
  const attrs = [`id="${escapeXml(draft.ruleId)}"`, `level="${draft.level}"`];
  if (draft.frequency) attrs.push(`frequency="${escapeXml(draft.frequency)}"`);
  if (draft.timeframe) attrs.push(`timeframe="${escapeXml(draft.timeframe)}"`);

  const dependencyLine = draft.dependencyType === 'none' ? '' : draft.dependencyType === 'decoded_as'
    ? `  <decoded_as>${escapeXml(draft.dependencyValue)}</decoded_as>\n`
    : `  <${draft.dependencyType}>${escapeXml(draft.dependencyValue)}</${draft.dependencyType}>\n`;
  const fieldLine = draft.fieldName && draft.fieldPattern
    ? `  <field name="${escapeXml(draft.fieldName)}" type="${escapeXml(draft.fieldType || 'pcre2')}">${escapeXml(draft.fieldPattern)}</field>\n`
    : '';
  const sameFieldLine = draft.sameField ? `  <same_field>${escapeXml(draft.sameField)}</same_field>\n` : '';
  const mitreBlock = draft.mitre.length ? `  <mitre>\n${draft.mitre.map((id) => `    <id>${escapeXml(id)}</id>`).join('\n')}\n  </mitre>\n` : '';
  return `<rule ${attrs.join(' ')}>\n${dependencyLine}${fieldLine}${sameFieldLine}  <description>${escapeXml(draft.description)}</description>\n  <options>no_full_log</options>\n  <info type="text">use_case:${escapeXml(draft.useCaseId)}</info>\n  <group>${groups.map(escapeXml).join(',')},</group>\n${mitreBlock}</rule>`;
}

export function buildQaSkeletonFromDraft(draft: RuleTemplateDraft, template?: RuleTemplate): string {
  return `# QA Test Skeleton - ${draft.ruleId}\n\n## Rule\n- Rule ID: ${draft.ruleId}\n- Description: ${draft.description}\n- Use case: ${draft.useCaseId}\n- Role: ${inferRoleFromDraft(draft)}\n- Jira visible: ${draft.level >= 11 ? 'yes' : 'no'}\n\n## Positive test\n- Expected result: rule ${draft.ruleId} should trigger.\n- Sample guidance: ${template?.qaPositiveHint || 'Paste a log that satisfies the dependency, field, and correlation conditions.'}\n\n## Negative test\n- Expected result: rule ${draft.ruleId} should not trigger.\n- Sample guidance: ${template?.qaNegativeHint || 'Paste a similar benign log that should not match the detection logic.'}\n\n## Logtest command\n\`sudo /var/ossec/bin/wazuh-logtest\`\n\n## Evidence to attach\n- Raw test log\n- wazuh-logtest output\n- Observed rule ID(s)\n- Analyst verdict\n`;
}

export function buildTemplateMarkdown(templates = RULE_TEMPLATES): string {
  return [`# Wazuh Rule Template Library`, '', `Templates: ${templates.length}`, '', ...templates.map((template) => [
    `## ${template.name}`,
    '',
    `- ID: ${template.id}`,
    `- Kind: ${template.kind}`,
    `- Use case: ${template.useCaseId}`,
    `- Level: ${template.level}`,
    `- Dependency: ${template.dependencyType}:${template.dependencyValue || 'none'}`,
    `- MITRE: ${template.mitre.join(', ') || 'none'}`,
    `- Groups: ${template.groups.join(', ')}`,
    '',
    template.notes,
    '',
  ].join('\n'))].join('\n');
}

function escapeXml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
