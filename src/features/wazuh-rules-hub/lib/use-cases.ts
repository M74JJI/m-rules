import type { UseCaseRecord } from './types';

export const USE_CASE_COMPONENTS = [
  'Azure',
  'Office',
  'Intune',
  'Windows',
  'Linux',
  'Sophos EDR',
  'Sophos FW',
  'Fortigate',
  'Cloudflare',
] as const;

const SYSTEM_CREATOR = 'System';

const withSystemMeta = (record: Omit<UseCaseRecord, 'source' | 'createdBy'>): UseCaseRecord => ({
  ...record,
  source: 'system',
  createdBy: SYSTEM_CREATOR,
});

export const USE_CASES: UseCaseRecord[] = [
  withSystemMeta({
    id: 'uc_fgt_foundation',
    name: 'FortiGate Compatibility Foundation',
    shortName: 'Foundation',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Foundation',
    description: 'Compatibility and base helper logic that anchors FortiGate KV/CEF events before detection-specific rules execute.',
  }),
  withSystemMeta({
    id: 'uc_fgt_parser_health',
    name: 'FortiGate Parser Health & Field Quality Monitoring',
    shortName: 'Parser Health',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Parser Quality',
    description: 'Detects malformed, null, placeholder, or weak parser outputs that can damage downstream detection reliability.',
  }),
  withSystemMeta({
    id: 'uc_fgt_admin_auth',
    name: 'FortiGate Administrative Access & Authentication Monitoring',
    shortName: 'Admin Auth',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Identity & Access',
    description: 'Covers administrator login success, login failure, brute-force patterns, default admin usernames, and weak management-channel activity.',
  }),
  withSystemMeta({
    id: 'uc_fgt_admin_config',
    name: 'FortiGate Administrative Configuration Change Monitoring',
    shortName: 'Admin Config',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Configuration Security',
    description: 'Tracks firewall policy, object, administrator, VPN, logging, and security-profile configuration changes.',
  }),
  withSystemMeta({
    id: 'uc_fgt_vpn_auth',
    name: 'FortiGate VPN Authentication & Remote Access Monitoring',
    shortName: 'VPN Auth',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Remote Access',
    description: 'Detects SSL VPN/IPsec failures, repeated login failures, invalid users, suspicious usernames, tunnel events, and success-after-failures.',
  }),
  withSystemMeta({
    id: 'uc_fgt_traffic_policy',
    name: 'FortiGate Traffic Policy & Network Flow Monitoring',
    shortName: 'Traffic Policy',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Traffic Monitoring',
    description: 'Monitors allowed/denied policy traffic, repeated denies, risky services, unusual flow behavior, and exposure signals.',
  }),
  withSystemMeta({
    id: 'uc_fgt_utm_security',
    name: 'FortiGate UTM Security Control Monitoring',
    shortName: 'UTM Security',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Security Controls',
    description: 'Unifies WebFilter, DNSFilter, IPS, AV, AppControl, and anomaly event visibility from FortiGate UTM telemetry.',
  }),
  withSystemMeta({
    id: 'uc_fgt_threat_reputation',
    name: 'FortiGate Threat Intelligence & Reputation Monitoring',
    shortName: 'Threat Intel',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Threat Intelligence',
    description: 'Detects C2, malware, reputation, exploit, and known-bad indicators surfaced by FortiGate security telemetry.',
  }),
  withSystemMeta({
    id: 'uc_fgt_ips_exploit',
    name: 'FortiGate IPS Exploit Attempt Monitoring',
    shortName: 'IPS Exploit',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Intrusion Prevention',
    description: 'Covers IPS exploit signatures, repeated exploit bursts, exploit-source/destination correlations, and public-facing service exploitation attempts.',
  }),
  withSystemMeta({
    id: 'uc_fgt_malware_file',
    name: 'FortiGate Malware & File Security Monitoring',
    shortName: 'Malware/File',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Malware Defense',
    description: 'Tracks infected file detections, blocked malware transfers, suspicious file names, malware families, and repeated file-security bursts.',
  }),
  withSystemMeta({
    id: 'uc_fgt_dnsfilter_threat',
    name: 'FortiGate DNSFilter Threat Monitoring',
    shortName: 'DNS Threats',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'DNS Security',
    description: 'Detects malicious domains, suspicious DNS categories, blocked DNS activity, and repeated DNS threat patterns.',
  }),
  withSystemMeta({
    id: 'uc_fgt_webfilter_threat',
    name: 'FortiGate WebFilter Threat Monitoring',
    shortName: 'Web Threats',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Web Security',
    description: 'Detects malicious URLs, phishing, C2 web access, risky categories, repeated web threat bursts, and suspicious hostnames.',
  }),
  withSystemMeta({
    id: 'uc_fgt_dos_anomaly',
    name: 'FortiGate DoS, Anomaly & Scan Monitoring',
    shortName: 'DoS/Anomaly',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Network Attack',
    description: 'Covers FortiGate anomaly events, floods, DoS signatures, scan-like behavior, and repeated anomaly bursts.',
  }),
  withSystemMeta({
    id: 'uc_fgt_exposure_config',
    name: 'FortiGate Policy Exposure & Security Weakening Monitoring',
    shortName: 'Exposure Config',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Exposure Management',
    description: 'Highlights risky policy exposure, disabled security controls, weakened inspection, permissive access, and dangerous configuration changes.',
  }),
  withSystemMeta({
    id: 'uc_fgt_ha_cluster',
    name: 'FortiGate HA Cluster & Availability Monitoring',
    shortName: 'HA Cluster',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Availability',
    description: 'Monitors HA failover, cluster state, split-brain indicators, member failures, and availability risk signals.',
  }),
  withSystemMeta({
    id: 'uc_fgt_sdwan_routing',
    name: 'FortiGate Routing & SD-WAN Monitoring',
    shortName: 'Routing / SD-WAN',
    component: 'Fortigate',
    vendor: 'fortigate',
    product: 'FortiGate / FortiOS',
    domain: 'Firewall / Network Security',
    category: 'Routing',
    description: 'Tracks route, BGP, SD-WAN, gateway, SLA, and path-selection events that affect connectivity and security posture.',
  }),
];

export const GROUP_TO_USE_CASE: Record<string, string> = {
  fortigate_premium: 'uc_fgt_foundation',
  fortigate_decoded: 'uc_fgt_foundation',
  fortigate_parser_health: 'uc_fgt_parser_health',
  fortigate_admin_auth: 'uc_fgt_admin_auth',
  fortigate_admin_config: 'uc_fgt_admin_config',
  fortigate_policy_change: 'uc_fgt_admin_config',
  fortigate_vpn_auth: 'uc_fgt_vpn_auth',
  fortigate_vpn_failed: 'uc_fgt_vpn_auth',
  fortigate_traffic_policy: 'uc_fgt_traffic_policy',
  fortigate_utm_security: 'uc_fgt_utm_security',
  fortigate_threat_intel: 'uc_fgt_threat_reputation',
  fortigate_ips_exploit: 'uc_fgt_ips_exploit',
  fortigate_malware_file: 'uc_fgt_malware_file',
  fortigate_dnsfilter_threat: 'uc_fgt_dnsfilter_threat',
  fortigate_webfilter_threat: 'uc_fgt_webfilter_threat',
  fortigate_dos_anomaly: 'uc_fgt_dos_anomaly',
  fortigate_anomaly: 'uc_fgt_dos_anomaly',
  fortigate_dos: 'uc_fgt_dos_anomaly',
  fortigate_exposure_config: 'uc_fgt_exposure_config',
  fortigate_security_weakened: 'uc_fgt_exposure_config',
  fortigate_ha: 'uc_fgt_ha_cluster',
  fortigate_sdwan: 'uc_fgt_sdwan_routing',
  fortigate_routing: 'uc_fgt_sdwan_routing',
};

export const slugifyUseCaseToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

export const mergeUseCases = (customUseCases: UseCaseRecord[]) => {
  const merged = new Map<string, UseCaseRecord>();
  [...USE_CASES, ...customUseCases].forEach((useCase) => {
    if (!useCase.id) return;
    merged.set(useCase.id, useCase);
  });
  return [...merged.values()].sort((a, b) =>
    a.component.localeCompare(b.component) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
};

export const getUseCaseById = (catalog: UseCaseRecord[], id: string) => catalog.find((useCase) => useCase.id === id);

export const getUseCaseLabel = (catalog: UseCaseRecord[], id: string) => getUseCaseById(catalog, id)?.name || id;

export const buildUseCaseId = (component: string, name: string, existingIds: Iterable<string>) => {
  const componentSlug = slugifyUseCaseToken(component) || 'custom';
  const nameSlug = slugifyUseCaseToken(name) || 'detection';
  const used = new Set(existingIds);
  const base = `uc_${componentSlug}_${nameSlug}`;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
};
