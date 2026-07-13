'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Boxes,
  Braces,
  ChartNoAxesCombined,
  CircleGauge,
  ClipboardCheck,
  CodeXml,
  Database,
  FileCode2,
  FileSearch,
  GitBranch,
  Library,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Tags,
  UploadCloud,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Button, FieldLabel, Input, SectionHeader, Select, SubtleCard, SurfaceCard, Textarea } from '@/components/ui/primitives';
import { cx } from '@/lib/cx';
import type { DecoderRecord, ParsedCollection, RuleRecord, UploadedFile, UseCaseRecord, ValidationIssue } from './lib/types';
import { parseCollection, readUploadedFiles } from './lib/parser';
import { ALL_TENANTS, getRecordTenant } from './lib/tenants';
import { buildUseCaseId, getUseCaseById, getUseCaseLabel, mergeUseCases, USE_CASE_COMPONENTS } from './lib/use-cases';
import { buildDecoderIntelligence, type FieldMatrixRow } from './lib/field-matrix';
import { buildGraphData, layoutGraph, type GraphEdge, type GraphFilters, type GraphLayout, type GraphMode, type PositionedNode } from './lib/graph-engine';
import { buildQualitySummary, type RuleQualityScore } from './lib/rule-quality';
import { buildFieldIntelligence } from './lib/field-intelligence';
import { buildRulePackCoverage, type UseCaseCoverageRow } from './lib/rule-pack-coverage';
import { RULE_TEMPLATES, buildQaSkeletonFromDraft, buildRuleXmlFromDraft, buildTemplateMarkdown, draftFromExistingRule, draftFromTemplate, inferRoleFromDraft, suggestNextRuleId, type RuleTemplate, type RuleTemplateDraft } from './lib/rule-templates';
import { buildAiAnalysis, type AiAnalysisResult } from './lib/ai-rule-intelligence';
import { searchParsedCollection } from './lib/search-query';
import { analyzeXmlRoundtrip, buildRoundtripMarkdownReport } from './lib/xml-roundtrip';

type ActiveView = 'upload' | 'command' | 'templates' | 'composer' | 'useCaseStudio' | 'coverage' | 'quality' | 'usecases' | 'rules' | 'decoders' | 'fields' | 'graph' | 'mitre' | 'validation' | 'files' | 'search' | 'ai' | 'roundtrip' | 'fieldIntel';
type Selected = { type: 'rule'; item: RuleRecord } | { type: 'decoder'; item: DecoderRecord } | { type: 'issue'; item: ValidationIssue } | null;
type CurrentUser = { id?: string; name?: string | null; email?: string | null };
type ManagerArchiveStatus = {
  rootPath: string | null;
  archiveCount: number;
  fileCount: number;
  completedArchives?: number;
  completedXmlFiles?: number;
  totalArchives?: number;
  totalXmlFiles?: number;
  currentArchive?: string;
  phase?: 'idle' | 'scanning' | 'extracting' | 'ready' | 'error';
  cached?: boolean;
  loadedAt?: string;
  fingerprint?: string;
  errors: string[];
};
type ManagerArchiveInfo = { name: string; size: number; modifiedAt: string; xmlFiles: number };
type ManagerStreamEvent =
  | { type: 'start'; rootPath: string | null; archives: ManagerArchiveInfo[]; totalArchives: number; totalXmlFiles: number; fingerprint: string; loadedAt: string; errors: string[]; cached: boolean }
  | { type: 'archive'; archive: ManagerArchiveInfo; files: UploadedFile[]; completedArchives: number; completedXmlFiles: number; totalArchives: number; totalXmlFiles: number; errors: string[] }
  | { type: 'archive-error'; archive: Pick<ManagerArchiveInfo, 'name' | 'xmlFiles'>; completedArchives: number; completedXmlFiles: number; totalArchives: number; totalXmlFiles: number; errors: string[] }
  | { type: 'done'; rootPath: string | null; archives: ManagerArchiveInfo[]; files: UploadedFile[]; fingerprint: string; loadedAt: string; errors: string[]; cached: boolean }
  | { type: 'error'; error: string };

const empty: ParsedCollection = {
  files: [], rules: [], decoders: [], useCases: [], issues: [],
  stats: { rules: 0, decoders: 0, useCases: 0, jiraVisible: 0, testing: 0, production: 0, critical: 0, mitreMapped: 0, missingUseCase: 0, brokenDependencies: 0 },
};

const fmt = (n: number) => new Intl.NumberFormat().format(n);
const ucName = (catalog: UseCaseRecord[], id: string) => getUseCaseLabel(catalog, id);
const tenantLabel = (tenant: string) => tenant === ALL_TENANTS ? 'All clients' : tenant;

const stableTextHash = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const dedupeBy = <T,>(items: T[], keyFor: (item: T) => string) => {
  const seen = new Map<string, T>();
  for (const item of items) {
    const key = keyFor(item);
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
};

const buildCollectionFromParts = (
  source: ParsedCollection,
  files: UploadedFile[],
  rules: RuleRecord[],
  decoders: DecoderRecord[],
  issues: ValidationIssue[],
  useCaseCatalog: UseCaseRecord[],
): ParsedCollection => {
  const usedUseCases = new Set(rules.map((rule) => rule.useCaseId).filter((id) => id && id !== 'unassigned'));
  const activeUseCases = useCaseCatalog.filter((useCase) => usedUseCases.has(useCase.id));
  const brokenDependencies = issues.filter((issue) => ['external_or_missing_sid', 'missing_group_dependency', 'missing_decoder'].includes(issue.type)).length;
  return {
    ...source,
    files,
    rules,
    decoders,
    useCases: activeUseCases,
    issues,
    stats: {
      rules: rules.length,
      decoders: decoders.length,
      useCases: usedUseCases.size,
      jiraVisible: rules.filter((rule) => rule.jiraVisible).length,
      testing: rules.filter((rule) => rule.status === 'testing').length,
      production: rules.filter((rule) => rule.status === 'production').length,
      critical: rules.filter((rule) => rule.severity === 'critical').length,
      mitreMapped: rules.filter((rule) => rule.mitre.length > 0).length,
      missingUseCase: rules.filter((rule) => rule.useCaseId === 'unassigned').length,
      brokenDependencies,
    },
  };
};

const buildScopedIssues = (files: UploadedFile[], rules: RuleRecord[], decoders: DecoderRecord[], useCaseCatalog: UseCaseRecord[]) => {
  const issues: ValidationIssue[] = [];
  const knownUseCases = new Set(useCaseCatalog.map((useCase) => useCase.id));
  const ruleGroups = new Map<string, RuleRecord[]>();
  const decoderGroups = new Map<string, DecoderRecord[]>();
  const groupsProduced = new Set<string>();
  const ruleIds = new Set(rules.map((rule) => rule.id));
  const decoderNames = new Set(decoders.map((decoder) => decoder.name));

  rules.forEach((rule) => {
    ruleGroups.set(rule.id, [...(ruleGroups.get(rule.id) || []), rule]);
    rule.groups.forEach((group) => groupsProduced.add(group));
  });
  decoders.forEach((decoder) => decoderGroups.set(decoder.name, [...(decoderGroups.get(decoder.name) || []), decoder]));

  for (const [id, scopedRules] of ruleGroups) {
    if (scopedRules.length > 1) issues.push({ severity: 'error', type: 'duplicate_rule_id', title: `Duplicate rule ID ${id}`, detail: `${scopedRules.length} rules share the same Wazuh rule ID in this client scope.`, ruleId: id, tenant: scopedRules[0]?.tenant });
  }
  for (const [name, scopedDecoders] of decoderGroups) {
    if (scopedDecoders.length > 1) issues.push({ severity: 'warning', type: 'duplicate_decoder_name', title: `Duplicate decoder ${name}`, detail: `${scopedDecoders.length} decoder blocks share the same decoder name in this client scope.`, decoderName: name, tenant: scopedDecoders[0]?.tenant });
  }

  for (const rule of rules) {
    if (rule.useCaseId === 'unassigned') issues.push({ severity: 'warning', type: 'missing_use_case', title: `Rule ${rule.id} has no use case`, detail: 'Add <info type="text">use_case:...</info> or extend fallback mappings.', ruleId: rule.id, fileName: rule.sourceFile, tenant: rule.tenant });
    if (rule.useCaseId !== 'unassigned' && !knownUseCases.has(rule.useCaseId)) issues.push({ severity: 'warning', type: 'unknown_use_case_registry', title: `Rule ${rule.id} uses unknown use case ${rule.useCaseId}`, detail: 'The use_case info tag resolves to an ID that is not registered in the use-case catalog.', ruleId: rule.id, fileName: rule.sourceFile, tenant: rule.tenant });
    if (rule.jiraVisible && rule.mitre.length === 0) issues.push({ severity: 'warning', type: 'jira_without_mitre', title: `Jira-visible rule ${rule.id} has no MITRE`, detail: 'Level >= 11 but no MITRE technique was found.', ruleId: rule.id, tenant: rule.tenant });
    if (rule.level === 0 && rule.mitre.length > 0) issues.push({ severity: 'info', type: 'helper_with_mitre', title: `Helper rule ${rule.id} has MITRE`, detail: 'Level 0 helper rules usually should not carry ATT&CK mapping unless intentional.', ruleId: rule.id, tenant: rule.tenant });
    if (rule.level > 15) issues.push({ severity: 'warning', type: 'level_above_standard', title: `Rule ${rule.id} level is above 15`, detail: `Detected level ${rule.level}. Confirm this is accepted by your Wazuh version and workflow.`, ruleId: rule.id, tenant: rule.tenant });
    for (const dependency of rule.dependencies) {
      if ((dependency.type === 'if_sid' || dependency.type === 'if_matched_sid') && !ruleIds.has(dependency.value)) issues.push({ severity: 'warning', type: 'external_or_missing_sid', title: `Rule ${rule.id} references SID ${dependency.value}`, detail: 'The SID was not found in this client scope. It may be stock Wazuh, external, or missing.', ruleId: rule.id, tenant: rule.tenant });
      if ((dependency.type === 'if_group' || dependency.type === 'if_matched_group') && !groupsProduced.has(dependency.value)) issues.push({ severity: 'warning', type: 'missing_group_dependency', title: `Rule ${rule.id} references group ${dependency.value}`, detail: 'No rule in this client scope produces this group. It may be external, missing, or typo.', ruleId: rule.id, tenant: rule.tenant });
      if (dependency.type === 'decoded_as' && !decoderNames.has(dependency.value)) issues.push({ severity: 'warning', type: 'missing_decoder', title: `Rule ${rule.id} uses decoder ${dependency.value}`, detail: 'No decoder block in this client scope has this exact decoder name.', ruleId: rule.id, tenant: rule.tenant });
    }
  }

  for (const decoder of decoders) {
    if (decoder.parent && !decoderNames.has(decoder.parent)) issues.push({ severity: 'info', type: 'external_decoder_parent', title: `Decoder ${decoder.name} parent not uploaded`, detail: `Parent decoder ${decoder.parent} was not found in this client scope. It may be stock/built-in or in another file.`, decoderName: decoder.name, tenant: decoder.tenant });
  }
  for (const file of files) {
    if (file.type === 'unknown') issues.push({ severity: 'info', type: 'unknown_file_type', title: `Unknown file type: ${file.name}`, detail: 'The file did not clearly look like rules or decoders XML.', fileName: file.name, tenant: getRecordTenant(file) });
  }

  return issues;
};

const buildTenantScopedCollection = (source: ParsedCollection, selectedTenant: string, useCaseCatalog: UseCaseRecord[]) => {
  if (selectedTenant !== ALL_TENANTS) {
    const byTenant = (item: { tenant?: string; sourceFile?: string; name?: string; fileName?: string }) => getRecordTenant(item) === selectedTenant;
    const files = source.files.filter(byTenant);
    const rules = source.rules.filter(byTenant);
    const decoders = source.decoders.filter(byTenant);
    return buildCollectionFromParts(
      source,
      files,
      rules,
      decoders,
      buildScopedIssues(files, rules, decoders, useCaseCatalog),
      useCaseCatalog,
    );
  }

  const rules = dedupeBy(source.rules, (rule) => `${rule.id}:${stableTextHash(rule.rawXml || rule.description)}`);
  const decoders = dedupeBy(source.decoders, (decoder) => `${decoder.name}:${stableTextHash(decoder.rawXml)}`);
  const files = dedupeBy(source.files, (file) => `${file.type}:${stableTextHash(file.content)}`);
  const issues = dedupeBy(buildScopedIssues(files, rules, decoders, useCaseCatalog), (issue) => `${issue.severity}:${issue.type}:${issue.ruleId || ''}:${issue.decoderName || ''}:${issue.title}:${issue.detail}`);

  return buildCollectionFromParts(source, files, rules, decoders, issues, useCaseCatalog);
};

const GRAPH_COLLECTION_KEY = 'wri.graphCollection.v1';
const MANAGER_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const TABLE_PAGE_SIZE = 100;
const severityDotClass: Record<ValidationIssue['severity'], string> = {
  error: 'bg-destructive',
  warning: 'bg-[var(--warning)]',
  info: 'bg-[var(--accent)]',
};
const severityTextClass: Record<ValidationIssue['severity'], string> = {
  error: 'text-destructive',
  warning: 'text-[color:var(--warning)]',
  info: 'text-[var(--accent)]',
};
const severityBadgeClass: Record<ValidationIssue['severity'], string> = {
  error: 'border border-destructive/25 bg-destructive/10 text-destructive',
  warning: 'border border-[color:var(--warning)]/25 bg-[color:var(--warning)]/12 text-[color:var(--warning)]',
  info: 'border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]',
};
const levelTextClass = (severity: RuleRecord['severity']) => (
  severity === 'critical'
    ? 'text-destructive'
    : severity === 'high'
      ? 'text-[color:var(--warning)]'
      : severity === 'medium'
        ? 'text-yellow-600 dark:text-yellow-400'
        : 'text-[var(--text-soft)]'
);
const statusPillClass = (tone: 'success' | 'danger' | 'warning' | 'info' | 'muted') => (
  tone === 'success'
    ? 'border border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
    : tone === 'danger'
      ? 'border border-destructive/25 bg-destructive/10 text-destructive'
      : tone === 'warning'
        ? 'border border-[color:var(--warning)]/25 bg-[color:var(--warning)]/12 text-[color:var(--warning)]'
        : tone === 'info'
          ? 'border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'border border-border/70 bg-muted/60 text-muted-foreground'
);
const decoderChipClass = 'rounded-md border border-[var(--primary)]/20 bg-[var(--primary)]/10 px-2 py-0.5 text-xs font-mono font-bold text-[var(--primary)]';
const decoderLinkClass = 'text-xs font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline';

function rememberGraphCollection(parsed: ParsedCollection) {
  void parsed;
}

function restoreGraphCollection(): ParsedCollection {
  return empty;
}

const NAV_VIEWS: { id: ActiveView; label: string; desc: string; group: string; icon: LucideIcon }[] = [
  { id: 'command', label: 'Overview', desc: 'Summary and operational status', group: 'Workspace', icon: CircleGauge },
  { id: 'upload', label: 'Data source', desc: 'Refresh manager archives', group: 'Workspace', icon: Database },
  { id: 'rules', label: 'Rules', desc: 'Explore and search detection rules', group: 'Detection', icon: ShieldCheck },
  { id: 'decoders', label: 'Decoders', desc: 'Inspect decoder hierarchy', group: 'Detection', icon: Braces },
  { id: 'usecases', label: 'Use cases', desc: 'Browse detection coverage tree', group: 'Detection', icon: ListTree },
  { id: 'fields', label: 'Field matrix', desc: 'Map decoder-to-rule coverage', group: 'Detection', icon: TableProperties },
  { id: 'fieldIntel', label: 'Field intelligence', desc: 'Inspect lineage, aliases, and risk', group: 'Detection', icon: Tags },
  { id: 'graph', label: 'Dependency graph', desc: 'Explore ruleset topology', group: 'Analytics', icon: GitBranch },
  { id: 'mitre', label: 'MITRE ATT&CK', desc: 'Review technique coverage', group: 'Analytics', icon: Radar },
  { id: 'coverage', label: 'Coverage', desc: 'Analyze detection coverage', group: 'Analytics', icon: ChartNoAxesCombined },
  { id: 'validation', label: 'Validation', desc: 'Review quality gates and issues', group: 'Governance', icon: ClipboardCheck },
  { id: 'quality', label: 'Quality scores', desc: 'Review rule score and risk', group: 'Governance', icon: Activity },
  { id: 'files', label: 'Source files', desc: 'Inspect raw XML evidence', group: 'Governance', icon: FileCode2 },
  { id: 'templates', label: 'Templates', desc: 'Browse rule template library', group: 'Authoring', icon: Library },
  { id: 'composer', label: 'Rule composer', desc: 'Build rule XML visually', group: 'Authoring', icon: CodeXml },
  { id: 'useCaseStudio', label: 'Use case studio', desc: 'Register and search use cases', group: 'Authoring', icon: Boxes },
  { id: 'search', label: 'Global search', desc: 'Query all loaded intelligence', group: 'Tools', icon: Search },
  { id: 'ai', label: 'Rule analysis', desc: 'Run deterministic rule analysis', group: 'Tools', icon: Sparkles },
  { id: 'roundtrip', label: 'XML roundtrip', desc: 'Analyze XML reconstruction', group: 'Tools', icon: FileSearch },
];
const NAV_GROUPS = ['Workspace', 'Detection', 'Analytics', 'Governance', 'Authoring', 'Tools'];

// ---- Utility helpers ----
const copyToClipboard = async (value: string) => { if (!value) return; await navigator.clipboard.writeText(value); };
const downloadText = (fileName: string, content: string, type = 'text/plain') => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};

// ---- KPI Card ----
function KPI({ label, value, sub, tone }: { label: string; value: number | string; sub: string; tone?: string }) {
  const Icon = tone === 'red' ? ClipboardCheck : tone === 'amber' ? Activity : tone === 'green' ? ShieldCheck : ChartNoAxesCombined;
  const toneClass =
    tone === 'red'
      ? 'border-red-500/25 bg-red-500/10'
      : tone === 'amber'
        ? 'border-amber-500/25 bg-amber-500/10'
        : tone === 'green'
          ? 'border-emerald-500/25 bg-emerald-500/10'
          : 'border-sky-500/20 bg-sky-500/10';
  return (
    <SubtleCard className={cx('dashboard-kpi p-4', toneClass)} data-tone={tone || 'cyan'}>
      <span className="dashboard-kpi-icon"><Icon /></span>
      <div className="dashboard-kpi-copy">
        <div className="dashboard-kpi-value">{typeof value === 'number' ? fmt(value) : value}</div>
        <div className="dashboard-kpi-label">{label}</div>
        <div className="dashboard-kpi-sub">{sub}</div>
      </div>
    </SubtleCard>
  );
}

// ---- Status Chip ----
function Chip({ children, kind }: { children: React.ReactNode; kind?: 'mitre' | 'warn' | 'good' }) {
  return (
    <Badge
      tone={kind === 'mitre' ? 'warning' : kind === 'warn' ? 'danger' : kind === 'good' ? 'success' : 'muted'}
      className="text-xs"
    >
      {children}
    </Badge>
  );
}

function usePagedRows<T>(rows: T[], pageSize = TABLE_PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);
  const start = page * pageSize;
  return {
    page,
    setPage,
    totalPages,
    pageRows: rows.slice(start, start + pageSize),
    start,
    end: Math.min(rows.length, start + pageSize),
  };
}

function PageControls({
  total,
  page,
  totalPages,
  start,
  end,
  setPage,
}: {
  total: number;
  page: number;
  totalPages: number;
  start: number;
  end: number;
  setPage: (page: number) => void;
}) {
  if (total <= TABLE_PAGE_SIZE) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-soft)]">
      <span>{fmt(start + 1)}-{fmt(end)} of {fmt(total)}</span>
      <div className="flex items-center gap-2">
        <Button className="h-8 text-xs" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>Prev</Button>
        <span>Page {fmt(page + 1)} / {fmt(totalPages)}</span>
        <Button className="h-8 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(Math.min(totalPages - 1, page + 1))}>Next</Button>
      </div>
    </div>
  );
}

// ---- Upload Card ----
function UploadCard({ onLoaded, files }: { onLoaded: (files: UploadedFile[]) => void; files: UploadedFile[] }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const load = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try { onLoaded(await readUploadedFiles(list)); } finally { setBusy(false); }
  };
  return (
    <SurfaceCard className="p-4 md:p-5 space-y-4">
      <SectionHeader
        eyebrow="Import Files"
        title="Upload XML"
        description="Add one or more Wazuh rule or decoder files for review."
      />
      <div
        className="group flex min-h-28 cursor-pointer items-center gap-4 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--panel-2)] px-5 py-4 text-left transition-colors hover:border-[var(--primary)] hover:bg-[var(--accent-soft)]"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); void load(e.dataTransfer.files); }}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel)] text-[var(--primary)]"><UploadCloud className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--text)]">{busy ? 'Parsing files...' : 'Drop files here or browse'}</div>
          <div className="mt-1 text-xs text-[var(--text-soft)]">Wazuh XML, HTML, or TXT · multiple files supported</div>
        </div>
        <span className="hidden rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] sm:inline">Browse</span>
        <input
          ref={inputRef}
          type="file" multiple accept=".xml,.html,.txt"
          className="hidden"
          onChange={(e) => { void load(e.target.files); e.target.value = ''; }}
        />
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.slice(0, 24).map((f) => (
            <SubtleCard key={f.hash} className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs">
              <span className="text-[var(--text)] font-medium">{f.name}</span>
              <span className="text-[var(--text-soft)]">{f.type} · {(f.size / 1024).toFixed(1)} KB</span>
            </SubtleCard>
          ))}
          {files.length > 24 ? <Badge tone="muted" className="text-xs">+{fmt(files.length - 24)} more</Badge> : null}
        </div>
      )}
      {files.length === 0 && (
        <div className="text-xs text-[var(--text-soft)]">No files loaded.</div>
      )}
    </SurfaceCard>
  );
}

function RulesHubTopBar({
  data,
  rawData,
  hasData,
  busy,
  managerStatus,
  tenants,
  selectedTenant,
  onTenantChange,
  onRefreshManager,
  onLoadFiles,
}: {
  data: ParsedCollection;
  rawData: ParsedCollection;
  hasData: boolean;
  busy: boolean;
  managerStatus: ManagerArchiveStatus;
  tenants: string[];
  selectedTenant: string;
  onTenantChange: (tenant: string) => void;
  onRefreshManager: () => void;
  onLoadFiles: (files: FileList | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mitreTechniques = useMemo(() => new Set(data.rules.flatMap((rule) => rule.mitre)).size, [data.rules]);
  const highCriticalRules = useMemo(() => data.rules.filter((rule) => rule.level >= 11).length, [data.rules]);
  const progressTotal = managerStatus.totalArchives || managerStatus.archiveCount || 0;
  const progressDone = managerStatus.completedArchives || 0;
  const progressPct = progressTotal ? Math.round((progressDone / progressTotal) * 100) : 0;
  const kpis = [
    { label: 'Rules', value: data.stats.rules, sub: 'parsed detections', tone: 'cyan' },
    { label: 'Decoders', value: data.stats.decoders, sub: 'lineage blocks', tone: 'purple' },
    { label: 'MITRE techniques', value: mitreTechniques, sub: 'covered ATT&CK IDs', tone: 'green' },
    { label: 'Validation issues', value: data.issues.length, sub: 'quality signals', tone: data.issues.length ? 'red' : 'green' },
    { label: 'Broken dependencies', value: data.stats.brokenDependencies, sub: 'unresolved links', tone: data.stats.brokenDependencies ? 'red' : 'green' },
    { label: 'High/Critical rules', value: highCriticalRules, sub: 'level 11+', tone: highCriticalRules ? 'amber' : 'green' },
  ];

  return (
    <SurfaceCard className="workspace-overview relative overflow-hidden rounded-none border-x-0 border-t-0 bg-[var(--panel)] p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/35 to-transparent" />
      <div className="workspace-overview-main flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="workspace-overview-copy max-w-4xl space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-soft)]">Workspace overview</span>
            <Badge className="text-xs" tone="muted">{hasData ? `${fmt(data.files.length)} files` : 'Ready for import'}</Badge>
            {hasData ? <Badge className="text-xs" tone="muted">{selectedTenant === ALL_TENANTS ? 'All clients deduped' : `Client ${selectedTenant}`}</Badge> : null}
          </div>
          <h1 className="max-w-3xl text-2xl font-bold tracking-[-0.035em] text-[var(--text)] md:text-[2rem]">Detection operations</h1>
          <p className="max-w-3xl text-sm leading-6 text-[var(--text)]/80 md:text-[15px]">
            Operational view of Wazuh rules, decoder coverage, validation findings, and client scope.
          </p>
        </div>
        <SubtleCard className="workspace-source-panel min-w-0 flex flex-col gap-4 p-4 xl:min-w-[340px]">
          {hasData ? (
            <div className="space-y-1.5">
              <FieldLabel>Client scope</FieldLabel>
              <Select className="h-9 text-xs font-semibold" value={selectedTenant} onChange={(event) => onTenantChange(event.target.value)}>
                <option value={ALL_TENANTS}>All clients (deduped)</option>
                {tenants.map((tenant) => <option key={tenant} value={tenant}>{tenantLabel(tenant)}</option>)}
              </Select>
              <div className="text-[11px] text-[var(--text-soft)]">
                Showing {fmt(data.rules.length)} of {fmt(rawData.rules.length)} rules.
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text)]">Manager archives</div>
              <div className="max-w-[210px] truncate text-xs text-[var(--text)]/70" title={managerStatus.rootPath || undefined}>
                {managerStatus.rootPath || 'SIEM_MANAGERS_DIR not resolved'}
              </div>
            </div>
            <Button tone="primary" onClick={onRefreshManager} disabled={busy}>
              {busy ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".xml,.html,.txt"
            className="hidden"
            onChange={(event) => {
              onLoadFiles(event.target.files);
              event.target.value = '';
            }}
          />
          {hasData ? (
            <div className="hidden">
              {data.files.slice(0, 4).map((file) => (
                <div key={file.hash} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1">
                  <span className="truncate text-[var(--text)]" title={file.name}>{file.name}</span>
                  <span className="shrink-0">{getRecordTenant(file)} · {file.type}</span>
                </div>
              ))}
              {data.files.length > 4 ? <div className="text-[10px] uppercase tracking-widest">+{data.files.length - 4} more files</div> : null}
            </div>
          ) : (
            <div className="hidden">
              Refresh the configured archive folder to activate graph modes, validation, MITRE, fields, and rule intelligence.
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5">
              <div className="font-semibold text-[var(--text)]">{managerStatus.archiveCount}</div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-soft)]">archives</div>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5">
              <div className="font-semibold text-[var(--text)]">{managerStatus.fileCount}</div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-soft)]">xml files</div>
            </div>
            <button
              type="button"
              className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-left text-[var(--text)] transition-colors hover:bg-[var(--panel-2)]"
              onClick={() => inputRef.current?.click()}
            >
              <div className="font-semibold">Manual</div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-soft)]">fallback</div>
            </button>
          </div>
          {busy || managerStatus.phase === 'extracting' || managerStatus.phase === 'scanning' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--text-soft)]">
                <span className="truncate">
                  {managerStatus.phase === 'scanning'
                    ? 'Scanning archives'
                    : managerStatus.currentArchive
                      ? `Loading ${managerStatus.currentArchive}`
                      : 'Loading manager source'}
                </span>
                <span className="shrink-0">{progressDone}/{progressTotal || '?'} archives</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--panel)]">
                <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="text-[11px] text-[var(--text-soft)]">
                {fmt(managerStatus.completedXmlFiles || 0)}/{fmt(managerStatus.totalXmlFiles || 0)} XML files ready
              </div>
            </div>
          ) : null}
          {managerStatus.loadedAt ? (
            <div className="text-[11px] text-[var(--text-soft)]">
              Last refresh {new Date(managerStatus.loadedAt).toLocaleString()}{managerStatus.cached ? ' · cached' : ''}
            </div>
          ) : null}
          {managerStatus.errors.length ? (
            <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {managerStatus.errors.slice(0, 2).join(' ')}
            </div>
          ) : null}
        </SubtleCard>
      </div>
      {hasData ? (
        <div className="workspace-kpi-grid mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi) => <KPI key={kpi.label} label={kpi.label} value={kpi.value} sub={kpi.sub} tone={kpi.tone} />)}
        </div>
      ) : null}
    </SurfaceCard>
  );
}

function EmptyGraphWorkbench({ onLoadFiles, onRefreshManager, busy }: { onLoadFiles: (files: FileList | null) => void; onRefreshManager: () => void; busy: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <SurfaceCard className="rules-graph-workbench-empty flex min-h-[650px] flex-col overflow-hidden p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-2 pb-3">
        <div>
          <div className="text-sm font-bold text-[var(--text)]">Graph</div>
          <div className="text-xs text-[var(--text-soft)]">Load files to map rules and decoder relationships.</div>
        </div>
        <div className="flex gap-2">
          <Button tone="primary" onClick={onRefreshManager} disabled={busy}>
            {busy ? 'Refreshing...' : 'Refresh Source'}
          </Button>
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>Manual XML</Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xml,.html,.txt"
          className="hidden"
          onChange={(event) => {
            onLoadFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      <div className="relative mt-3 flex flex-1 min-h-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-[var(--graph-stage-bg)]">
        <div className="absolute inset-0 rules-graph-grid opacity-70" />
        <div className="relative max-w-lg px-6 text-center">
          <GitBranch className="mx-auto size-5 text-[var(--primary)]" />
          <h2 className="mt-3 text-lg font-semibold tracking-tight text-[var(--text)]">No dependency map yet</h2>
          <p className="mt-1.5 text-sm leading-6 text-[var(--text-soft)]">
            The server reads every configured manager archive and loads rules plus decoders automatically.
          </p>
        </div>
      </div>
    </SurfaceCard>
  );
}

// ---- Overview / Command Center ----
function CommandCenter({ data }: { data: ParsedCollection }) {
  const statusBreakdown = useMemo(() => {
    const map = new Map<string, number>(); data.rules.forEach((r) => map.set(r.status, (map.get(r.status) || 0) + 1)); return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.rules]);
  const roleBreakdown = useMemo(() => {
    const map = new Map<string, number>(); data.rules.forEach((r) => map.set(r.role, (map.get(r.role) || 0) + 1)); return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.rules]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SurfaceCard className="p-4">
          <div className="text-sm font-semibold text-[var(--text)] mb-3">Ruleset Posture</div>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[var(--text-soft)] uppercase mb-1">Status Distribution</div>
            {statusBreakdown.map(([k, v]) => (
              <div key={k} className="distribution-row">
                <div><span>{k}</span><strong>{fmt(v)}</strong></div>
                <div className="distribution-track"><span style={{ width: `${data.rules.length ? (v / data.rules.length) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="space-y-2 mt-4">
            <div className="text-xs font-semibold text-[var(--text-soft)] uppercase mb-1">Role Distribution</div>
            {roleBreakdown.map(([k, v]) => (
              <div key={k} className="distribution-row">
                <div><span>{k}</span><strong>{fmt(v)}</strong></div>
                <div className="distribution-track"><span style={{ width: `${data.rules.length ? (v / data.rules.length) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-4">
          <div className="text-sm font-semibold text-[var(--text)] mb-3">Top Validation Signals</div>
          {data.issues.length === 0 ? (
            <div className="text-sm text-[var(--text-soft)] italic">No validation issues yet. Upload files to start analysis.</div>
          ) : (
            <div className="space-y-2">
              {data.issues.slice(0, 10).map((i, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <span className={cx('mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full', severityDotClass[i.severity])} />
                  <span className="text-[var(--text)]">{i.title}</span>
                  <span className={cx('ml-auto shrink-0 text-xs', severityTextClass[i.severity])}>{i.severity.toUpperCase()}</span>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}

// ---- Rule Explorer ----
function RuleExplorer({ data, onSelect }: { data: ParsedCollection; onSelect: (s: Selected) => void }) {
  const [q, setQ] = useState(''); const [role, setRole] = useState('all'); const [status, setStatus] = useState('all'); const [jira, setJira] = useState('all');
  const deferredQ = useDeferredValue(q);
  const rows = useMemo(() => data.rules.filter((r) => {
    const query = deferredQ.toLowerCase();
    const hay = `${r.id} ${r.description} ${r.groups.join(' ')} ${r.mitre.join(' ')} ${r.useCaseId} ${r.fields.map(f => `${f.name} ${f.value}`).join(' ')}`.toLowerCase();
    return (!query || hay.includes(query)) && (role === 'all' || r.role === role) && (status === 'all' || r.status === status) && (jira === 'all' || String(r.jiraVisible) === jira);
  }), [data.rules, deferredQ, role, status, jira]);
  const paged = usePagedRows(rows);
  const roles = [...new Set(data.rules.map(r => r.role))]; const statuses = [...new Set(data.rules.map(r => r.status))];
  return (
    <SurfaceCard className="p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-[var(--text)]">Rule Explorer</h2>
          <p className="text-sm text-[var(--text-soft)]">Every SID, level, group, dependency, MITRE mapping, and Jira visibility.</p>
        </div>
        <Badge tone="muted">{rows.length}/{data.rules.length}</Badge>
      </div>
      <SubtleCard className="!flex !flex-row !flex-nowrap items-center gap-2 overflow-x-auto p-3">
        <Input className="h-9 w-[260px] min-w-[260px] shrink-0 text-xs" placeholder="Search rule ID, group, MITRE, field..." value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="h-9 min-w-[160px] shrink-0 text-xs font-semibold" value={role} onChange={(e) => setRole(e.target.value)}><option value="all">All roles</option>{roles.map(r => <option key={r}>{r}</option>)}</Select>
        <Select className="h-9 min-w-[160px] shrink-0 text-xs font-semibold" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All status</option>{statuses.map(s => <option key={s}>{s}</option>)}</Select>
        <Select className="h-9 min-w-[170px] shrink-0 text-xs font-semibold" value={jira} onChange={(e) => setJira(e.target.value)}><option value="all">All Jira</option><option value="true">Jira visible</option><option value="false">Jira hidden</option></Select>
      </SubtleCard>
      <PageControls total={rows.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-soft)] uppercase tracking-wider"><th className="p-2">Client</th><th className="p-2">ID</th><th className="p-2">Lvl</th><th className="p-2">Role</th><th className="p-2">Status</th><th className="p-2">Use Case</th><th className="p-2">Description</th><th className="p-2">MITRE</th><th className="p-2">Groups</th></tr></thead>
          <tbody>
            {paged.pageRows.map(r => (
              <tr key={`${r.sourceFile}-${r.id}`} onClick={() => onSelect({ type: 'rule', item: r })} className="border-b border-[var(--border)] hover:bg-[var(--accent-soft)] cursor-pointer transition-colors">
                <td className="p-2"><Chip>{getRecordTenant(r)}</Chip></td>
                <td className="p-2"><span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-mono font-bold text-[var(--accent)]">{r.id}</span></td>
                <td className="p-2"><span className={cx('font-semibold', levelTextClass(r.severity))}>{r.level}</span></td>
                <td className="p-2 text-[var(--text)]">{r.role}</td>
                <td className="p-2 text-[var(--text)]">{r.status}</td>
                <td className="p-2"><Chip kind={r.useCaseConfidence === 'confirmed' ? 'good' : r.useCaseId === 'unassigned' ? 'warn' : undefined}>{r.useCaseId}</Chip></td>
                <td className="p-2 text-[var(--text)] max-w-xs truncate">{r.description}</td>
                <td className="p-2"><div className="flex flex-wrap gap-1">{r.mitre.slice(0, 3).map(m => <Chip kind="mitre" key={m}>{m}</Chip>)}</div></td>
                <td className="p-2"><div className="flex flex-wrap gap-1">{r.groups.slice(0, 3).map(g => <Chip key={g}>{g}</Chip>)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PageControls total={rows.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
    </SurfaceCard>
  );
}

// ---- Decoder Explorer ----
function DecoderExplorer({ data, onSelect }: { data: ParsedCollection; onSelect: (s: Selected) => void }) {
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);
  const rows = useMemo(() => data.decoders.filter(d => `${d.name} ${d.parent || ''} ${d.orderFields.join(' ')} ${d.regex.join(' ')}`.toLowerCase().includes(deferredQ.toLowerCase())), [data.decoders, deferredQ]);
  const paged = usePagedRows(rows);
  return (
    <SurfaceCard className="p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h2 className="text-lg font-bold text-[var(--text)]">Decoder Explorer</h2><p className="text-sm text-[var(--text-soft)]">Decoder hierarchy, parent chains, regex blocks, and output fields.</p></div>
        <Badge tone="muted">{rows.length}/{data.decoders.length}</Badge>
      </div>
      <SubtleCard className="p-3">
        <Input placeholder="Search decoder, parent, order field, regex..." value={q} onChange={(e) => setQ(e.target.value)} />
      </SubtleCard>
      <PageControls total={rows.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-soft)] uppercase tracking-wider"><th className="p-2">Client</th><th className="p-2">Decoder</th><th className="p-2">Parent</th><th className="p-2">Order Fields</th><th className="p-2">Regex</th><th className="p-2">Source</th></tr></thead>
          <tbody>
            {paged.pageRows.map((d, i) => (
              <tr key={`${d.name}-${i}`} onClick={() => onSelect({ type: 'decoder', item: d })} className="border-b border-[var(--border)] hover:bg-[var(--accent-soft)] cursor-pointer transition-colors">
                <td className="p-2"><Chip>{getRecordTenant(d)}</Chip></td>
                <td className="p-2"><span className={decoderChipClass}>{d.name}</span></td>
                <td className="p-2 text-[var(--text)]">{d.parent || 'none'}</td>
                <td className="p-2"><div className="flex flex-wrap gap-1">{d.orderFields.slice(0, 8).map(f => <Chip key={f}>{f}</Chip>)}</div></td>
                <td className="p-2 text-[var(--text)]">{d.regex.length} blocks</td>
                <td className="p-2 text-[var(--text-soft)] text-xs">{d.sourceFile}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PageControls total={rows.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
    </SurfaceCard>
  );
}

// ---- Field Coverage Matrix ----
function FieldCoverageMatrix({ data, onSelect }: { data: ParsedCollection; onSelect: (s: Selected) => void }) {
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);
  const [filterStatus, setFilterStatus] = useState<'all' | 'covered' | 'rule_only' | 'decoder_only'>('all');
  const intel = useMemo(() => buildDecoderIntelligence(data), [data]);
  const rows = useMemo(() => intel.matrixRows.filter((row) => {
    const query = deferredQ.toLowerCase();
    const hay = `${row.field} ${row.status} ${row.producedBy.map((d) => d.name).join(' ')} ${row.usedByRules.map((r) => `${r.id} ${r.description}`).join(' ')}`.toLowerCase();
    return (filterStatus === 'all' || row.status === filterStatus) && (!query || hay.includes(query));
  }), [intel.matrixRows, deferredQ, filterStatus]);
  const paged = usePagedRows(rows);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI label="Produced fields" value={intel.stats.producedFields} sub="From decoder <order>" tone="purple" />
        <KPI label="Used fields" value={intel.stats.usedFields} sub="In rule conditions" tone="cyan" />
        <KPI label="Covered" value={intel.stats.coveredFields} sub="Produced & used" tone="green" />
        <KPI label="Rule-only gaps" value={intel.stats.ruleOnlyFields} sub="Used but not produced" tone="red" />
        <KPI label="Decoder-only" value={intel.stats.decoderOnlyFields} sub="Produced but unused" tone="amber" />
        <KPI label="decoded_as links" value={intel.stats.decodedAsLinks} sub="Direct bindings" tone="cyan" />
      </div>
      <SurfaceCard className="p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div><h2 className="text-lg font-bold text-[var(--text)]">Decoder → Rule Field Matrix</h2><p className="text-sm text-[var(--text-soft)]">Coverage gaps between decoded fields and rule usage.</p></div>
          <Badge tone="muted">{rows.length}/{intel.matrixRows.length}</Badge>
        </div>
        <SubtleCard className="!flex !flex-row !flex-nowrap items-center gap-2 overflow-x-auto p-3">
          <Input className="h-9 w-[260px] min-w-[260px] shrink-0 text-xs" placeholder="Search field, decoder, rule..." value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="h-9 min-w-[170px] shrink-0 text-xs font-semibold" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}><option value="all">All</option><option value="covered">Covered</option><option value="rule_only">Rule-only</option><option value="decoder_only">Decoder-only</option></Select>
        </SubtleCard>
        <PageControls total={rows.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-soft)] uppercase tracking-wider"><th className="p-2">Field</th><th className="p-2">Status</th><th className="p-2">Produced By</th><th className="p-2">Used By Rules</th><th className="p-2">Use Cases</th><th className="p-2">Jira/Crit</th></tr></thead>
            <tbody>
              {paged.pageRows.map((row) => (
                <tr key={row.field} className="border-b border-[var(--border)]">
                  <td className="p-2"><span className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-0.5 text-xs font-mono font-bold text-[var(--text)]">{row.field}</span></td>
                  <td className="p-2"><span className={cx('rounded-md px-2 py-0.5 text-xs font-semibold', row.status === 'covered' ? statusPillClass('success') : row.status === 'rule_only' ? statusPillClass('danger') : statusPillClass('warning'))}>{row.status}</span></td>
                  <td className="p-2"><div className="flex flex-wrap gap-1">{row.producedBy.slice(0, 5).map((d, i) => <button key={`${d.name}-${i}`} className={decoderLinkClass} onClick={() => { const dec = data.decoders.find(x => x.name === d.name); if (dec) onSelect({ type: 'decoder', item: dec }); }}>{d.name}</button>)}</div></td>
                  <td className="p-2"><div className="flex flex-wrap gap-1">{row.usedByRules.slice(0, 8).map((r) => <button key={r.id} className="text-xs font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline" onClick={() => onSelect({ type: 'rule', item: r })}>{r.id}</button>)}</div></td>
                  <td className="p-2"><div className="flex flex-wrap gap-1">{row.useCaseIds.slice(0, 4).map((u) => <Chip key={u}>{u}</Chip>)}</div></td>
                  <td className="p-2 text-[var(--text-soft)] text-xs">{row.jiraVisibleRules} J · {row.criticalRules} C</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PageControls total={rows.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
      </SurfaceCard>
    </div>
  );
}

// ---- Graph Workbench ----
function DependencyGraph({ data, useCases, onSelect }: { data: ParsedCollection; useCases: UseCaseRecord[]; onSelect: (s: Selected) => void }) {
  const [mode, setMode] = useState<GraphMode>('rules');
  const [layout, setLayout] = useState<GraphLayout>('layered');
  const [query, setQuery] = useState('');
  const [useCaseId, setUseCaseId] = useState('all');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [jiraOnly, setJiraOnly] = useState(false);
  const [includeExternal, setIncludeExternal] = useState(true);
  const [limit, setLimit] = useState(120);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reflowSignal, setReflowSignal] = useState(0);
  const workbenchRef = useRef<HTMLDivElement | null>(null);

  const filters: GraphFilters = { mode, query, useCaseId, status, role, jiraOnly, includeExternal, limit };
  const graph = useMemo(() => buildGraphData(data, filters), [data, mode, query, useCaseId, status, role, jiraOnly, includeExternal, limit]);
  const laidOut = useMemo(() => layoutGraph(graph, layout), [graph, layout]);
  const statuses = [...new Set(data.rules.map((r) => r.status))].sort();
  const roles = [...new Set(data.rules.map((r) => r.role))].sort();
  const useCaseOptions = [...new Set(data.rules.map((r) => r.useCaseId).filter(Boolean))].sort();
  const connected = useMemo(() => {
    if (!focusId) return null;
    const ids = new Set<string>([focusId]);
    laidOut.edges.forEach((e) => { if (e.source === focusId) ids.add(e.target); if (e.target === focusId) ids.add(e.source); });
    return ids;
  }, [focusId, laidOut.edges]);

  // Real browser Fullscreen API
  const requestGraphReflow = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => setReflowSignal((value) => value + 1), 80);
    });
  }, []);

  const enterFullscreen = useCallback(() => {
    const el = workbenchRef.current;
    if (!el) return;
    try {
      void el.requestFullscreen();
    } catch {
      /* Fullscreen API unavailable. Keep the embedded workbench usable. */
    }
  }, []);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch { /* not supported */ }
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) exitFullscreen(); else enterFullscreen();
  }, [enterFullscreen, exitFullscreen]);

  // Track fullscreen state via browser events
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === workbenchRef.current);
      requestGraphReflow();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [requestGraphReflow]);

  useEffect(() => {
    requestGraphReflow();
  }, [mode, layout, query, useCaseId, status, role, jiraOnly, includeExternal, limit, focusId, requestGraphReflow]);

  const handleLayoutChange = useCallback((nextLayout: GraphLayout) => {
    setLayout(nextLayout);
    setFocusId(null);
    requestGraphReflow();
  }, [requestGraphReflow]);

  // Toolbar shared between normal and fullscreen modes
  const graphToolbar = (
    <SubtleCard className="rules-graph-toolbar !flex !flex-row !flex-nowrap items-center gap-2 overflow-x-auto p-3">
      <Select className="h-9 min-w-[170px] shrink-0 py-1 text-xs font-semibold" value={mode} onChange={(e) => setMode(e.target.value as GraphMode)}>
        <option value="rules">Rule dependencies</option><option value="decoders">Decoder parents</option><option value="decoder_rules">Decoder to rule</option><option value="fields">Decoder to field to rule</option><option value="use_cases">Use cases</option><option value="mitre">MITRE</option><option value="all">Blended intelligence</option>
      </Select>
      <Select className="h-9 min-w-[120px] shrink-0 py-1 text-xs font-semibold" value={layout} onChange={(e) => handleLayoutChange(e.target.value as GraphLayout)}><option value="layered">Layered</option><option value="radial">Radial</option></Select>
      <Input className="h-9 w-[240px] min-w-[240px] shrink-0 py-1 text-xs" placeholder="Search SID, decoder, group, field, MITRE..." value={query} onChange={(e) => setQuery(e.target.value)} />
      <Select className="h-9 min-w-[190px] shrink-0 py-1 text-xs font-semibold" value={useCaseId} onChange={(e) => setUseCaseId(e.target.value)}><option value="all">All use cases</option>{useCaseOptions.map((id) => <option key={id} value={id}>{ucName(useCases, id)}</option>)}</Select>
      <Select className="h-9 min-w-[140px] shrink-0 py-1 text-xs font-semibold" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All status</option>{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</Select>
      <Select className="h-9 min-w-[120px] shrink-0 py-1 text-xs font-semibold" value={role} onChange={(e) => setRole(e.target.value)}><option value="all">All roles</option>{roles.map((item) => <option key={item} value={item}>{item}</option>)}</Select>
      <Select className="h-9 min-w-[140px] shrink-0 py-1 text-xs font-semibold" value={limit} onChange={(e) => setLimit(Number(e.target.value))}><option value={80}>80 nodes</option><option value={120}>120 nodes</option><option value={260}>260 nodes</option><option value={520}>520 nodes</option></Select>
      <Button type="button" tone={jiraOnly ? 'primary' : 'default'} className="h-9 text-xs" aria-pressed={jiraOnly} onClick={() => setJiraOnly((v) => !v)}>Jira only</Button>
      <Button type="button" tone={includeExternal ? 'primary' : 'default'} className="h-9 text-xs" aria-pressed={includeExternal} onClick={() => setIncludeExternal((v) => !v)}>External</Button>
      <Button className="h-9 text-xs" onClick={requestGraphReflow}>Fit</Button>
      <Button className="h-9 text-xs" onClick={toggleFullscreen}>
        {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      </Button>
      <Button className="h-9 text-xs" onClick={() => { setQuery(''); setUseCaseId('all'); setStatus('all'); setRole('all'); setFocusId(null); setJiraOnly(false); setIncludeExternal(true); requestGraphReflow(); }}>Reset</Button>
    </SubtleCard>
  );

  return (
    <div className="space-y-4">
      {/* Header & KPIs — hidden in fullscreen */}
      {!isFullscreen && (
        <SurfaceCard className="p-4 md:p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div><h2 className="text-lg font-bold text-[var(--text)]">Graph</h2><p className="text-sm text-[var(--text-soft)]">Rule dependencies, decoder chains, use cases, and MITRE links.</p></div>
            <Badge tone="info">Interactive SVG graph</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPI label="Nodes" value={graph.stats.nodes} sub="rendered" tone="cyan" />
            <KPI label="Edges" value={graph.stats.edges} sub="relationships" tone="purple" />
            <KPI label="Rules" value={graph.stats.rules} sub="rule nodes" tone="green" />
            <KPI label="Decoders" value={graph.stats.decoders} sub="decoder nodes" tone="purple" />
            <KPI label="Fields" value={graph.stats.fields} sub="field nodes" tone="amber" />
            <KPI label="External" value={graph.stats.external} sub="stock deps" tone="red" />
          </div>
          {graphToolbar}
        </SurfaceCard>
      )}

      {/* Workbench container — target for fullscreen */}
      <div
        ref={workbenchRef}
        className={cx(
          'graph-workbench-host',
          isFullscreen && 'rules-graph-fullscreen flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]',
          !isFullscreen && 'rules-graph-workbench grid min-h-[720px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]',
        )}
      >
        {/* Fullscreen header & toolbar */}
        {isFullscreen && (
          <div className="graph-fs-header flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--panel)] p-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">Fullscreen Topology</span>
              <span className="text-sm font-bold text-[var(--text)] ml-3">Graph Workbench</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone="info" className="text-xs">{graph.stats.nodes} nodes</Badge>
              <Badge tone="info" className="text-xs">{graph.stats.edges} edges</Badge>
              <Button className="text-xs" onClick={exitFullscreen}>Exit Fullscreen</Button>
            </div>
          </div>
        )}

        {/* Fullscreen toolbar row */}
        {isFullscreen && graphToolbar}

        <div className={cx(isFullscreen ? 'flex min-h-0 flex-1 overflow-hidden' : 'contents')}>
          {/* Graph canvas area */}
          <div className={cx(
            'flex min-h-0 flex-col p-2',
            isFullscreen ? 'min-w-0 flex-1 rounded-none border-0 shadow-none' : 'min-h-[650px]',
          )}>
            <div className="mb-1 flex shrink-0 items-center justify-between gap-3 px-2 pt-1">
              <div className="text-sm font-semibold text-[var(--text)]">Interactive Topology</div>
              <div className="hidden text-xs text-[var(--text-soft)] sm:block">Wheel zoom, drag pan, click focus, double-click inspect</div>
            </div>
            <div className="flex-1 min-h-0">
              <GraphCanvas laidOut={laidOut} connected={connected} focusId={focusId} setFocusId={setFocusId} onSelect={onSelect} isFullscreen={isFullscreen} reflowSignal={reflowSignal} defaultFitMode={layout === 'radial' ? 'contain' : 'start'} />
            </div>
          </div>

          {/* Side panel */}
          <div className={cx('min-h-0', isFullscreen ? 'w-[340px] shrink-0 border-l border-[var(--border)] bg-[var(--panel)]' : '')}>
            <GraphSidePanel nodes={laidOut.nodes} edges={laidOut.edges} focusId={focusId} setFocusId={setFocusId} onSelect={(selectedItem) => { onSelect(selectedItem); requestGraphReflow(); }} isFullscreen={isFullscreen} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Graph Canvas (SVG) ----
function GraphCanvas({ laidOut, connected, focusId, setFocusId, onSelect, isFullscreen, reflowSignal, defaultFitMode = 'start' }: {
  laidOut: { nodes: PositionedNode[]; edges: GraphEdge[]; width: number; height: number };
  connected: Set<string> | null; focusId: string | null;
  setFocusId: (id: string | null) => void; onSelect: (s: Selected) => void;
  isFullscreen?: boolean;
  reflowSignal?: number;
  defaultFitMode?: 'contain' | 'comfort' | 'start';
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const wheelRafRef = useRef<number | null>(null);
  const panRafRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const interactionTimeoutRef = useRef<number | null>(null);
  const [zoom, setZoomState] = useState(1);
  const zoomRef = useRef(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
  const [dragging, setDragging] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [autoFitKey, setAutoFitKey] = useState(0);
  const nodeMap = new Map(laidOut.nodes.map((n) => [n.id, n]));

  const bounds = useMemo(() => {
    if (!laidOut.nodes.length) return { minX: 0, minY: 0, maxX: laidOut.width, maxY: laidOut.height, width: laidOut.width, height: laidOut.height };
    const minX = Math.min(...laidOut.nodes.map((n) => n.x));
    const minY = Math.min(...laidOut.nodes.map((n) => n.y));
    const maxX = Math.max(...laidOut.nodes.map((n) => n.x + (n.type === 'decoder' ? 250 : n.type === 'rule' ? 210 : 200)));
    const maxY = Math.max(...laidOut.nodes.map((n) => n.y + (n.type === 'field' ? 48 : 58)));
    return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }, [laidOut]);

  const setZoom = (value: number | ((current: number) => number)) => {
    setZoomState((current) => {
      const raw = typeof value === 'function' ? value(current) : value;
      const next = Math.max(0.05, Math.min(5.5, raw));
      zoomRef.current = next;
      return next;
    });
  };

  const markInteracting = () => {
    setInteracting(true);
    if (interactionTimeoutRef.current) window.clearTimeout(interactionTimeoutRef.current);
    interactionTimeoutRef.current = window.setTimeout(() => setInteracting(false), 180);
  };

  const fitToScreen = useCallback((mode: 'contain' | 'comfort' | 'start' = 'comfort') => {
    const el = stageRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    if (mode === 'start') {
      const largeGraph = laidOut.nodes.length > 180 || bounds.height > el.clientHeight * 2.2;
      const nextZoom = largeGraph ? Math.min(0.82, Math.max(0.55, el.clientWidth / Math.max(bounds.width, 1200))) : Math.max(0.42, Math.min(1, (el.clientWidth - 120) / bounds.width, (el.clientHeight - 110) / bounds.height));
      zoomRef.current = nextZoom; setZoomState(nextZoom);
      setPan({ x: 48 - bounds.minX * nextZoom, y: 58 - bounds.minY * nextZoom });
      return;
    }
    const padX = mode === 'contain' ? 42 : Math.min(160, Math.max(64, el.clientWidth * 0.10));
    const padY = mode === 'contain' ? 42 : Math.min(130, Math.max(56, el.clientHeight * 0.10));
    const safeW = Math.max(240, el.clientWidth - padX * 2);
    const safeH = Math.max(220, el.clientHeight - padY * 2);
    const nextZoom = Math.max(0.05, Math.min(1.12, safeW / bounds.width, safeH / bounds.height));
    zoomRef.current = nextZoom; setZoomState(nextZoom);
    setPan({ x: (el.clientWidth - bounds.width * nextZoom) / 2 - bounds.minX * nextZoom, y: Math.max(34, (el.clientHeight - bounds.height * nextZoom) / 2) - bounds.minY * nextZoom });
  }, [bounds.height, bounds.minX, bounds.minY, bounds.width, laidOut.nodes.length]);

  const resetView = () => fitToScreen('start');

  const scheduleSafeFit = useCallback((mode: 'contain' | 'comfort' | 'start' = 'start') => {
    let attempts = 0;
    const run = () => {
      const el = stageRef.current;
      const rect = el?.getBoundingClientRect();
      if (el && rect && rect.width >= 40 && rect.height >= 40) {
        setStageSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
        fitToScreen(mode);
        return;
      }
      attempts += 1;
      if (attempts < 12) {
        window.requestAnimationFrame(run);
      }
    };
    window.requestAnimationFrame(run);
  }, [fitToScreen]);

  const zoomAroundPoint = useCallback((px: number, py: number, factor: number) => {
    const current = zoomRef.current;
    const next = Math.max(0.05, Math.min(5.5, current * factor));
    if (Math.abs(next - current) < 0.0001) return;
    const ratio = next / current;
    zoomRef.current = next; setZoomState(next);
    setPan((p) => ({ x: px - (px - p.x) * ratio, y: py - (py - p.y) * ratio }));
  }, []);

  const zoomAtCenter = (factor: number) => {
    const el = stageRef.current; if (!el) { setZoom((z) => z * factor); return; }
    markInteracting(); zoomAroundPoint(el.clientWidth / 2, el.clientHeight / 2, factor);
  };

  // Auto-fit after layout data, filter, or fullscreen changes
  useEffect(() => {
    const t = window.setTimeout(() => scheduleSafeFit(defaultFitMode), 90);
    return () => window.clearTimeout(t);
  }, [laidOut.width, laidOut.height, laidOut.nodes.length, bounds.width, bounds.height, autoFitKey, isFullscreen, reflowSignal, defaultFitMode, scheduleSafeFit]);

  // ResizeObserver — update stage dimensions and refit on significant size changes
  const prevSizeRef = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        const w = el.clientWidth || 1;
        const h = el.clientHeight || 1;
        setStageSize({ width: w, height: h });
        // Trigger refit when the container actually gets meaningful dimensions
        // (e.g. after fullscreen transition, layout animation, or tab switch)
        if (Math.abs(w - prevSizeRef.current.w) > 40 || Math.abs(h - prevSizeRef.current.h) > 40) {
          prevSizeRef.current = { w, h };
          // Defer fit so fullscreen transitions, tab switches, and panel changes settle first.
          window.setTimeout(() => scheduleSafeFit(defaultFitMode), 120);
        }
      });
    });
    setStageSize({ width: el.clientWidth || 1, height: el.clientHeight || 1 });
    prevSizeRef.current = { w: el.clientWidth || 1, h: el.clientHeight || 1 };
    ro.observe(el);
    return () => ro.disconnect();
  }, [bounds.width, bounds.height, defaultFitMode, scheduleSafeFit]);

  useEffect(() => {
    const onResize = () => scheduleSafeFit(defaultFitMode);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [defaultFitMode, scheduleSafeFit]);

  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation(); markInteracting();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left; const py = event.clientY - rect.top;
      const normalizedDelta = Math.max(-220, Math.min(220, event.deltaY));
      const factor = Math.exp(-normalizedDelta * 0.00135);
      if (wheelRafRef.current) window.cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = window.requestAnimationFrame(() => zoomAroundPoint(px, py, factor));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => { el.removeEventListener('wheel', handleWheel); if (wheelRafRef.current) window.cancelAnimationFrame(wheelRafRef.current); if (panRafRef.current) window.cancelAnimationFrame(panRafRef.current); if (interactionTimeoutRef.current) window.clearTimeout(interactionTimeoutRef.current); };
  }, [zoomAroundPoint]);

  const visibleNodeIds = useMemo(() => {
    if (laidOut.nodes.length <= 260) return new Set(laidOut.nodes.map((n) => n.id));
    const margin = 900;
    const minX = (-pan.x / zoom) - margin; const minY = (-pan.y / zoom) - margin;
    const maxX = ((stageSize.width - pan.x) / zoom) + margin;
    const maxY = ((stageSize.height - pan.y) / zoom) + margin;
    const ids = new Set<string>();
    for (const n of laidOut.nodes) {
      const w = n.type === 'decoder' ? 250 : n.type === 'rule' ? 210 : 200;
      const h = n.type === 'field' ? 48 : 58;
      if (n.x + w >= minX && n.x <= maxX && n.y + h >= minY && n.y <= maxY) ids.add(n.id);
    }
    if (focusId) ids.add(focusId);
    if (connected) connected.forEach((id) => ids.add(id));
    return ids;
  }, [laidOut.nodes, pan.x, pan.y, zoom, stageSize.width, stageSize.height, focusId, connected]);

  const visibleEdges = useMemo(() => {
    if (visibleNodeIds.size === laidOut.nodes.length) return laidOut.edges;
    return laidOut.edges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
  }, [laidOut.edges, visibleNodeIds, laidOut.nodes.length]);

  const visibleNodes = useMemo(() => {
    if (visibleNodeIds.size === laidOut.nodes.length) return laidOut.nodes;
    return laidOut.nodes.filter((n) => visibleNodeIds.has(n.id));
  }, [laidOut.nodes, visibleNodeIds]);

  const edgePath = (edge: GraphEdge) => {
    const a = nodeMap.get(edge.source); const b = nodeMap.get(edge.target);
    if (!a || !b) return '';
    const aW = a.type === 'decoder' ? 250 : a.type === 'rule' ? 210 : 200;
    const bW = b.type === 'decoder' ? 250 : b.type === 'rule' ? 210 : 200;
    const aH = a.type === 'field' ? 48 : 58;
    const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x) * .52;
    if (vertical) {
      const sx = a.x + aW / 2; const sy = a.y + aH;
      const tx = b.x + bW / 2; const ty = b.y;
      const midY = sy + Math.max(64, (ty - sy) * .44);
      return `M${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
    }
    const sx = a.x + aW; const sy = a.y + aH / 2;
    const tx = b.x; const ty = b.y + (b.type === 'field' ? 24 : 29);
    const dx = Math.max(110, Math.abs(tx - sx) * .48);
    return `M${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
  };

  return (
    <div
      ref={stageRef}
      className={cx('rules-graph-stage relative h-full w-full overflow-hidden rounded-lg border border-border bg-[var(--graph-stage-bg)]', dragging && 'cursor-grabbing', !dragging && 'cursor-grab')}
      style={{ touchAction: 'none', minHeight: isFullscreen ? 0 : 520 }}
      onPointerDown={(event) => {
        if ((event.target as Element).closest('.graph-node') || (event.target as Element).closest('.graph-controls')) return;
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        event.preventDefault(); event.stopPropagation();
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true); setInteracting(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current; if (!drag) return;
        event.preventDefault();
        const dx = event.clientX - drag.startX; const dy = event.clientY - drag.startY;
        pendingPanRef.current = { x: drag.panX + dx, y: drag.panY + dy };
        if (!panRafRef.current) {
          panRafRef.current = window.requestAnimationFrame(() => { panRafRef.current = null; if (pendingPanRef.current) setPan(pendingPanRef.current); });
        }
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        setDragging(false); markInteracting();
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
      }}
      onPointerCancel={() => { dragRef.current = null; setDragging(false); markInteracting(); }}
    >
      <div className="graph-controls absolute top-3 left-3 z-10 flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        <button onClick={() => fitToScreen('start')} className="rounded bg-[var(--panel)]/90 px-2 py-1 text-xs text-[var(--text)] hover:bg-[var(--panel-2)] border border-[var(--border)]">Start</button>
        <button onClick={() => fitToScreen('contain')} className="rounded bg-[var(--panel)]/90 px-2 py-1 text-xs text-[var(--text)] hover:bg-[var(--panel-2)] border border-[var(--border)]">All</button>
        <button onClick={() => zoomAtCenter(1.18)} className="rounded bg-[var(--panel)]/90 px-2 py-1 text-xs text-[var(--text)] hover:bg-[var(--panel-2)] border border-[var(--border)]">+</button>
        <button onClick={() => zoomAtCenter(1 / 1.18)} className="rounded bg-[var(--panel)]/90 px-2 py-1 text-xs text-[var(--text)] hover:bg-[var(--panel-2)] border border-[var(--border)]">−</button>
        <button onClick={resetView} className="rounded bg-[var(--panel)]/90 px-2 py-1 text-xs text-[var(--text)] hover:bg-[var(--panel-2)] border border-[var(--border)]">Reset</button>
        <button onClick={() => setAutoFitKey((k) => k + 1)} className="rounded bg-[var(--panel)]/90 px-2 py-1 text-xs text-[var(--text)] hover:bg-[var(--panel-2)] border border-[var(--border)]">Refit</button>
        <span className="text-xs text-[var(--text-soft)] ml-2">{Math.round(zoom * 100)}%</span>
        <span className="text-xs text-[var(--text-soft)]">{visibleNodes.length}/{laidOut.nodes.length}</span>
      </div>
      <div className="graph-hint absolute top-3 right-3 z-10 text-xs text-[var(--text-soft)] bg-[var(--panel)]/70 rounded px-2 py-1 border border-[var(--border)]">Wheel zoom · drag pan · click focus · dbl-click inspect</div>
      <div className="graph-transform absolute inset-0" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, width: laidOut.width, height: laidOut.height, transformOrigin: '0 0' }}>
        <svg className="graph-svg block" viewBox={`0 0 ${laidOut.width} ${laidOut.height}`} width={laidOut.width} height={laidOut.height}>
          <defs>
            <filter id="nodeGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <linearGradient id="edgeGradient" x1="0" x2="1"><stop offset="0%" stopColor="var(--graph-edge-start)" /><stop offset="100%" stopColor="var(--graph-edge-end)" /></linearGradient>
          </defs>
          {visibleEdges.map((e) => <path key={e.id} className={cx('fill-none stroke-[1.5]', connected && (!connected.has(e.source) || !connected.has(e.target)) && 'opacity-15')} d={edgePath(e)} stroke="var(--graph-edge-stroke)" />)}
          {visibleNodes.map((n) => <GraphSvgNode key={n.id} node={n} dim={!!connected && !connected.has(n.id)} focused={focusId === n.id} onClick={() => setFocusId(focusId === n.id ? null : n.id)} onDoubleClick={() => { if (n.rule) onSelect({ type: 'rule', item: n.rule }); if (n.decoder) onSelect({ type: 'decoder', item: n.decoder }); }} />)}
        </svg>
      </div>
    </div>
  );
}

function GraphSvgNode({ node, dim, focused, onClick, onDoubleClick }: {
  node: PositionedNode; dim: boolean; focused: boolean; onClick: () => void; onDoubleClick: () => void;
}) {
  const width = node.type === 'rule' ? 210 : node.type === 'decoder' ? 250 : 200;
  const height = node.type === 'field' ? 48 : 58;
  const toneColors: Record<string, string> = {
    cyan: 'var(--graph-node-fill-cyan)', purple: 'var(--graph-node-fill-purple)', green: 'var(--graph-node-fill-green)',
    amber: 'var(--graph-node-fill-amber)', red: 'var(--graph-node-fill-red)', slate: 'var(--graph-node-fill-slate)',
  };
  const toneStroke: Record<string, string> = {
    cyan: 'var(--graph-node-stroke-cyan)', purple: 'var(--graph-node-stroke-purple)', green: 'var(--graph-node-stroke-green)',
    amber: 'var(--graph-node-stroke-amber)', red: 'var(--graph-node-stroke-red)', slate: 'var(--graph-node-stroke-slate)',
  };
  const fill = toneColors[node.tone] || toneColors.slate;
  const stroke = focused ? 'var(--graph-node-focus-stroke)' : toneStroke[node.tone] || toneStroke.slate;
  return (
    <g className={cx('graph-node cursor-pointer', dim && 'opacity-30', focused && 'opacity-100')} transform={`translate(${node.x},${node.y})`} onClick={onClick} onDoubleClick={onDoubleClick}>
      <rect width={width} height={height} rx="8" fill={fill} stroke={stroke} strokeWidth={focused ? 2.5 : 1.2} filter={focused ? 'url(#nodeGlow)' : undefined} />
      <text x="14" y="22" fontWeight="700" fontSize="12" fill="var(--graph-node-text)">{node.label.length > 30 ? `${node.label.slice(0, 30)}…` : node.label}</text>
      <text x="14" y="42" fontSize="10" fill="var(--graph-node-subtext)">{node.subtitle.length > 42 ? `${node.subtitle.slice(0, 42)}…` : node.subtitle}</text>
      <circle cx={width - 18} cy="18" r={Math.max(4, Math.min(10, 4 + node.size * 2))} fill={toneStroke[node.tone] || toneStroke.slate} />
    </g>
  );
}

function GraphSidePanel({ nodes, edges, focusId, setFocusId, onSelect, isFullscreen }: {
  nodes: PositionedNode[]; edges: GraphEdge[]; focusId: string | null;
  setFocusId: (id: string | null) => void; onSelect: (s: Selected) => void;
  isFullscreen?: boolean;
}) {
  const selected = nodes.find((n) => n.id === focusId);
  const neighbors = selected ? edges.filter((e) => e.source === selected.id || e.target === selected.id) : [];
  const topNodes = [...nodes].sort((a, b) => b.weight - a.weight).slice(0, 18);
  const byType = nodes.reduce<Record<string, number>>((acc, n) => { acc[n.type] = (acc[n.type] || 0) + 1; return acc; }, {});
  return (
    <SurfaceCard className={cx('space-y-3 overflow-y-auto p-4 custom-scrollbar', isFullscreen ? 'h-full max-h-none rounded-none border-0 shadow-none' : 'max-h-[650px]')}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[var(--text)]">Graph Intelligence</div>
        {focusId ? <Button className="text-xs" onClick={() => setFocusId(null)}>Clear</Button> : null}
      </div>
      <div className="text-xs text-[var(--text-soft)]">{nodes.length} nodes · {edges.length} edges</div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(byType).map(([k, v]) => <Chip key={k}>{k}: {v}</Chip>)}
      </div>
      {selected && (
        <div className="border border-[var(--accent)] rounded-lg p-3 bg-[var(--accent-soft)]">
          <div className="font-bold text-[var(--text)]">{selected.label}</div>
          <div className="text-xs text-[var(--text-soft)]">{selected.type} · {neighbors.length} relationships</div>
          <p className="text-xs text-[var(--text-soft)] mt-1">{selected.subtitle}</p>
          {selected.rule && <Button tone="primary" className="text-xs mt-2" onClick={() => onSelect({ type: 'rule', item: selected.rule! })}>Open rule inspector</Button>}
          {selected.decoder && <Button tone="primary" className="text-xs mt-2" onClick={() => onSelect({ type: 'decoder', item: selected.decoder! })}>Open decoder inspector</Button>}
          {focusId && <Button className="text-xs mt-2 ml-2" onClick={() => setFocusId(null)}>Clear focus</Button>}
        </div>
      )}
      <div>
        <div className="text-xs font-semibold text-[var(--text-soft)] uppercase mb-2">High-Impact Nodes</div>
        <div className="space-y-1">
          {topNodes.map((n) => (
            <button key={n.id} className={cx('flex w-full justify-between gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-[var(--accent-soft)]', focusId === n.id && 'border border-[var(--accent)] bg-[var(--accent-soft)]')} onClick={() => setFocusId(n.id)}>
              <span className="truncate text-[var(--text)]" title={n.label}>{n.label}</span>
              <span className="text-[var(--text-soft)]">{n.type} · w{Math.round(n.weight)}</span>
            </button>
          ))}
        </div>
      </div>
    </SurfaceCard>
  );
}

// ---- MITRE View ----
function MitreView({ data, onSelect }: { data: ParsedCollection; onSelect: (s: Selected) => void }) {
  const grouped = useMemo(() => {
    const map = new Map<string, RuleRecord[]>(); data.rules.forEach(r => r.mitre.forEach(m => map.set(m, [...(map.get(m) || []), r]))); return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data.rules]);
  const paged = usePagedRows(grouped);
  return (
    <SurfaceCard className="p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold text-[var(--text)]">MITRE ATT&amp;CK Coverage</h2><p className="text-sm text-[var(--text-soft)]">Technique-to-rule mapping with use-case links.</p></div>
        <Badge tone="muted">{grouped.length} techniques</Badge>
      </div>
      <PageControls total={grouped.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
      <div className="space-y-3">
        {paged.pageRows.map(([tech, rules]) => (
          <div key={tech} className="border border-[var(--border)] rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[var(--text)]">{tech}</span>
              <span className="text-xs text-[var(--text-soft)]">{rules.length} rules · {rules.filter(r => r.jiraVisible).length} Jira</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {rules.slice(0, 25).map(r => <button key={r.id} className="text-xs font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline px-1.5 py-0.5 rounded hover:bg-[var(--accent-soft)]" onClick={() => onSelect({ type: 'rule', item: r })}>{r.id}</button>)}
            </div>
          </div>
        ))}
        {grouped.length === 0 && <div className="text-sm text-[var(--text-soft)] italic">No MITRE mappings parsed yet.</div>}
      </div>
      <PageControls total={grouped.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
    </SurfaceCard>
  );
}

// ---- Validation Center ----
function ValidationCenter({ data }: { data: ParsedCollection }) {
  const sorted = useMemo(() => [...data.issues].sort((a, b) => ({ error: 0, warning: 1, info: 2 }[a.severity] - { error: 0, warning: 1, info: 2 }[b.severity])), [data.issues]);
  const paged = usePagedRows(sorted);
  return (
    <SurfaceCard className="p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold text-[var(--text)]">Validation Center</h2><p className="text-sm text-[var(--text-soft)]">Broken dependencies, missing use cases, duplicate IDs, decoder issues.</p></div>
        <Badge tone="danger">{sorted.length} issues</Badge>
      </div>
      <PageControls total={sorted.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
      <div className="space-y-2">
        {paged.pageRows.map((i, idx) => (
          <div key={idx} className="border border-[var(--border)] rounded-lg p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className={cx('rounded px-2 py-0.5 text-xs font-semibold uppercase', severityBadgeClass[i.severity])}>{i.severity}</span>
                <span className="text-sm font-semibold text-[var(--text)] ml-2">{i.title}</span>
              </div>
              <span className="text-xs text-[var(--text-soft)]">{i.type}{i.ruleId ? ` · rule ${i.ruleId}` : ''}</span>
            </div>
            <p className="text-xs text-[var(--text-soft)] mt-1">{i.detail}</p>
          </div>
        ))}
        {sorted.length === 0 && <div className="text-sm text-[var(--text-soft)] italic">No issues found for loaded files.</div>}
      </div>
      <PageControls total={sorted.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
    </SurfaceCard>
  );
}

// ---- Source Files View ----
function FilesView({ data }: { data: ParsedCollection }) {
  const paged = usePagedRows(data.files);
  const counts = useMemo(() => {
    const rules = new Map<string, number>();
    const decoders = new Map<string, number>();
    data.rules.forEach((rule) => rules.set(rule.sourceFile, (rules.get(rule.sourceFile) || 0) + 1));
    data.decoders.forEach((decoder) => decoders.set(decoder.sourceFile, (decoders.get(decoder.sourceFile) || 0) + 1));
    return { rules, decoders };
  }, [data.rules, data.decoders]);
  return (
    <SurfaceCard className="p-4 md:p-5 space-y-4">
      <div><h2 className="text-lg font-bold text-[var(--text)]">Source Files</h2><p className="text-sm text-[var(--text-soft)]">Raw file evidence, type detection, hashes, and parsed object counts.</p></div>
      <PageControls total={data.files.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
      <div className="space-y-2">
        {paged.pageRows.map(f => (
          <div key={f.hash} className="border border-[var(--border)] rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--text)]">{f.name}</span>
              <span className="text-xs text-[var(--text-soft)]">{f.type} · {(f.size / 1024).toFixed(1)} KB</span>
            </div>
            <div className="mt-2"><Chip>{getRecordTenant(f)}</Chip></div>
            <div className="text-xs text-[var(--text-soft)] mt-1 font-mono">sha256 {f.hash.slice(0, 24)}...</div>
            <div className="flex gap-2 mt-2">
              <Chip>{counts.rules.get(f.name) || 0} rules</Chip>
              <Chip>{counts.decoders.get(f.name) || 0} decoders</Chip>
            </div>
          </div>
        ))}
        {data.files.length === 0 && <div className="text-sm text-[var(--text-soft)] italic">No files loaded yet.</div>}
      </div>
      <PageControls total={data.files.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
    </SurfaceCard>
  );
}

// ---- Drawer / Inspector ----
function Drawer({ selected, onClose }: { selected: Selected; onClose: () => void }) {
  const [tab, setTab] = useState<'overview' | 'logic' | 'xml' | 'export'>('overview');
  useEffect(() => { setTab('overview'); }, [selected]);
  if (!selected) return null;
  const title = selected.type === 'rule' ? `Rule ${selected.item.id}` : selected.type === 'decoder' ? selected.item.name : selected.item.title;
  const desc = selected.type === 'rule' ? selected.item.description : selected.type === 'decoder' ? `Parent: ${selected.item.parent || 'none'}` : selected.item.detail;
  const exportPayload = JSON.stringify(selected.item, null, 2);
  const rawXml = selected.type === 'rule' || selected.type === 'decoder' ? selected.item.rawXml : selected.item.detail;
  return (
    <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose}>
      <aside className="fixed right-0 top-0 h-full w-full max-w-2xl bg-[var(--panel)] border-l border-[var(--border)] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-[var(--panel)] border-b border-[var(--border)] p-4 z-10">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">Inspector</div>
              <h2 className="text-lg font-bold text-[var(--text)]">{title}</h2>
              <p className="text-sm text-[var(--text-soft)]">{desc}</p>
            </div>
            <div className="flex gap-2">
              <Button className="text-xs" onClick={() => { void copyToClipboard(rawXml); }}>Copy XML</Button>
              <Button className="text-xs" onClick={() => downloadText(`${title.replace(/[^a-z0-9_-]+/gi, '_')}.json`, exportPayload, 'application/json')}>Export JSON</Button>
              <Button className="text-xs" onClick={onClose}>Close</Button>
            </div>
          </div>
          <div className="flex gap-1 mt-3">
            {(['overview', 'logic', 'xml', 'export'] as const).map(t => (
              <button key={t} className={cx('px-3 py-1 text-xs rounded-md transition-colors', tab === t ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-soft)] hover:text-[var(--text)] hover:bg-[var(--panel-2)]')} onClick={() => setTab(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </div>
        <div className="p-4">
          {selected.type === 'rule' && <>
            {tab === 'overview' && (
              <div className="space-y-4">
                <SurfaceCard className="p-4">
                  <h3 className="text-sm font-semibold text-[var(--text)] mb-3">Rule Metadata</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-[var(--text-soft)]">Level</span><span className="text-[var(--text)]">{selected.item.level} · {selected.item.severity}</span>
                    <span className="text-[var(--text-soft)]">Client</span><span className="text-[var(--text)]">{getRecordTenant(selected.item)}</span>
                    <span className="text-[var(--text-soft)]">Role</span><span className="text-[var(--text)]">{selected.item.role}</span>
                    <span className="text-[var(--text-soft)]">Status</span><span className="text-[var(--text)]">{selected.item.status}</span>
                    <span className="text-[var(--text-soft)]">Use Case</span><span className="text-[var(--text)]">{selected.item.useCaseId} · {selected.item.useCaseConfidence}</span>
                    <span className="text-[var(--text-soft)]">Jira</span><span className="text-[var(--text)]">{selected.item.jiraVisible ? 'visible' : 'hidden'}</span>
                    <span className="text-[var(--text-soft)]">Frequency</span><span className="text-[var(--text)]">{selected.item.frequency || 'none'} / {selected.item.timeframe || 'none'}</span>
                    <span className="text-[var(--text-soft)]">Source</span><span className="text-[var(--text)]">{selected.item.sourceSection || selected.item.sourceFile}</span>
                  </div>
                </SurfaceCard>
                <SurfaceCard className="p-4">
                  <h3 className="text-sm font-semibold text-[var(--text)] mb-2">Description</h3>
                  <p className="text-sm text-[var(--text)]">{selected.item.description}</p>
                  <div className="flex flex-wrap gap-1 mt-3">
                    {selected.item.mitre.map(m => <Chip kind="mitre" key={m}>{m}</Chip>)}
                    {selected.item.jiraVisible && <Chip kind="warn">Jira visible</Chip>}
                    <Chip>{selected.item.role}</Chip>
                    <Chip>{selected.item.status}</Chip>
                  </div>
                </SurfaceCard>
              </div>
            )}
            {tab === 'logic' && (
              <div className="space-y-4">
                <SurfaceCard className="p-4">
                  <h3 className="text-sm font-semibold text-[var(--text)] mb-2">Groups / MITRE / Dependencies</h3>
                  <div className="flex flex-wrap gap-1">
                    {selected.item.groups.map(g => <Chip key={g}>{g}</Chip>)}
                    {selected.item.mitre.map(m => <Chip kind="mitre" key={m}>{m}</Chip>)}
                    {selected.item.dependencies.map(d => <Chip key={`${d.type}-${d.value}`}>{d.type}:{d.value}</Chip>)}
                  </div>
                </SurfaceCard>
                <SurfaceCard className="p-4">
                  <h3 className="text-sm font-semibold text-[var(--text)] mb-2">Fields / Conditions</h3>
                  <div className="space-y-2">
                    {selected.item.fields.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm border border-[var(--border)] rounded p-2">
                        <b className="text-[var(--accent)]">{f.name}</b>
                        <span className="text-[var(--text-soft)]">{f.type || 'text'}</span>
                        <code className="text-[var(--text)] text-xs truncate flex-1">{f.value}</code>
                      </div>
                    ))}
                    {selected.item.fields.length === 0 && <div className="text-sm text-[var(--text-soft)] italic">No field conditions found.</div>}
                  </div>
                </SurfaceCard>
              </div>
            )}
            {tab === 'xml' && <pre className="text-xs text-[var(--text)] bg-[var(--panel-2)] rounded-lg p-4 overflow-x-auto font-mono whitespace-pre-wrap">{selected.item.rawXml}</pre>}
            {tab === 'export' && (
              <SurfaceCard className="p-4">
                <h3 className="text-sm font-semibold text-[var(--text)] mb-2">Export Payload</h3>
                <pre className="text-xs text-[var(--text)] bg-[var(--panel-2)] rounded-lg p-4 overflow-x-auto font-mono whitespace-pre-wrap">{exportPayload}</pre>
              </SurfaceCard>
            )}
          </>}
          {selected.type === 'decoder' && <>
            {tab === 'overview' && (
              <div className="space-y-4">
                <SurfaceCard className="p-4">
                  <h3 className="text-sm font-semibold text-[var(--text)] mb-3">Decoder Metadata</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-[var(--text-soft)]">Name</span><span className="text-[var(--text)]">{selected.item.name}</span>
                    <span className="text-[var(--text-soft)]">Client</span><span className="text-[var(--text)]">{getRecordTenant(selected.item)}</span>
                    <span className="text-[var(--text-soft)]">Parent</span><span className="text-[var(--text)]">{selected.item.parent || 'none'}</span>
                    <span className="text-[var(--text-soft)]">Regex blocks</span><span className="text-[var(--text)]">{selected.item.regex.length}</span>
                    <span className="text-[var(--text-soft)]">Order fields</span><span className="text-[var(--text)]">{selected.item.orderFields.length}</span>
                    <span className="text-[var(--text-soft)]">Source</span><span className="text-[var(--text)]">{selected.item.sourceFile}</span>
                  </div>
                </SurfaceCard>
                <SurfaceCard className="p-4">
                  <h3 className="text-sm font-semibold text-[var(--text)] mb-2">Produced Fields</h3>
                  <div className="flex flex-wrap gap-1">
                    {selected.item.orderFields.map(f => <Chip key={f}>{f}</Chip>)}
                    {selected.item.orderFields.length === 0 && <span className="text-sm text-[var(--text-soft)] italic">No order fields.</span>}
                  </div>
                </SurfaceCard>
              </div>
            )}
            {tab === 'logic' && (
              <SurfaceCard className="p-4">
                <h3 className="text-sm font-semibold text-[var(--text)] mb-2">Regex Blocks</h3>
                <div className="space-y-2">
                  {selected.item.regex.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm border border-[var(--border)] rounded p-2">
                      <b className="text-[var(--accent)] shrink-0">regex {i + 1}</b>
                      <code className="text-[var(--text)] text-xs break-all">{r}</code>
                    </div>
                  ))}
                  {selected.item.regex.length === 0 && <div className="text-sm text-[var(--text-soft)] italic">No regex blocks.</div>}
                </div>
              </SurfaceCard>
            )}
            {tab === 'xml' && <pre className="text-xs text-[var(--text)] bg-[var(--panel-2)] rounded-lg p-4 overflow-x-auto font-mono whitespace-pre-wrap">{selected.item.rawXml}</pre>}
            {tab === 'export' && (
              <SurfaceCard className="p-4">
                <h3 className="text-sm font-semibold text-[var(--text)] mb-2">Export Payload</h3>
                <pre className="text-xs text-[var(--text)] bg-[var(--panel-2)] rounded-lg p-4 overflow-x-auto font-mono whitespace-pre-wrap">{exportPayload}</pre>
              </SurfaceCard>
            )}
          </>}
          {selected.type === 'issue' && (
            <SurfaceCard className="p-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-[var(--text-soft)]">Severity</span><span className="text-[var(--text)]">{selected.item.severity}</span>
                <span className="text-[var(--text-soft)]">Type</span><span className="text-[var(--text)]">{selected.item.type}</span>
                <span className="text-[var(--text-soft)]">Client</span><span className="text-[var(--text)]">{getRecordTenant(selected.item)}</span>
                <span className="text-[var(--text-soft)]">Rule</span><span className="text-[var(--text)]">{selected.item.ruleId || 'none'}</span>
                <span className="text-[var(--text-soft)]">Decoder</span><span className="text-[var(--text)]">{selected.item.decoderName || 'none'}</span>
                <span className="text-[var(--text-soft)]">File</span><span className="text-[var(--text)]">{selected.item.fileName || 'none'}</span>
                <span className="text-[var(--text-soft)]">Detail</span><span className="text-[var(--text)] col-span-2">{selected.item.detail}</span>
              </div>
            </SurfaceCard>
          )}
        </div>
      </aside>
    </div>
  );
}

// ---- Rule Templates ----
function RuleTemplateLibraryCenter({ data, onSelect }: { data: ParsedCollection; onSelect: (s: Selected) => void }) {
  const [kind, setKind] = useState<'all' | RuleTemplate['kind']>('all');
  const [selectedTemplateId, setSelectedTemplateId] = useState(RULE_TEMPLATES[0]?.id || '');
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [customRuleId, setCustomRuleId] = useState('');
  const [status, setStatus] = useState('testing');
  const templates = useMemo(() => RULE_TEMPLATES.filter((t) => kind === 'all' || t.kind === kind), [kind]);
  const selectedTemplate = useMemo(() => RULE_TEMPLATES.find((t) => t.id === selectedTemplateId) || templates[0] || RULE_TEMPLATES[0], [selectedTemplateId, templates]);
  const selectedRule = useMemo(() => data.rules.find((r) => r.id === selectedRuleId), [data.rules, selectedRuleId]);
  const suggestedId = useMemo(() => suggestNextRuleId(data), [data]);
  const draft = useMemo<RuleTemplateDraft>(() => {
    if (selectedRule) return { ...draftFromExistingRule(selectedRule, data), ruleId: customRuleId || suggestNextRuleId(data, Number(selectedRule.id) + 1 || 100000), status };
    return draftFromTemplate(selectedTemplate, data, { ruleId: customRuleId || suggestedId, status });
  }, [selectedRule, selectedTemplate, data, customRuleId, suggestedId, status]);
  const xml = useMemo(() => buildRuleXmlFromDraft(draft), [draft]);
  const qa = useMemo(() => buildQaSkeletonFromDraft(draft, selectedTemplate), [draft, selectedTemplate]);
  const existingIds = useMemo(() => new Set(data.rules.map((r) => r.id)), [data.rules]);
  const collision = existingIds.has(draft.ruleId);
  const role = inferRoleFromDraft(draft);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI label="Templates" value={RULE_TEMPLATES.length} sub="built-in patterns" tone="cyan" />
        <KPI label="Selected Kind" value={kind === 'all' ? 'all' : kind} sub="template type" tone="purple" />
        <KPI label="Matching" value={templates.length} sub="shown" tone="green" />
        <KPI label="Role" value={role} sub="auto-derived" tone="amber" />
        <KPI label="ID" value={collision ? 'COLLISION' : 'clear'} sub={draft.ruleId} tone={collision ? 'red' : 'green'} />
        <KPI label="Jira" value={draft.level >= 11 ? 'visible' : 'hidden'} sub={`L${draft.level}`} tone={draft.level >= 11 ? 'amber' : 'green'} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SurfaceCard className="p-4 space-y-3">
          <div><h2 className="text-sm font-bold text-[var(--text)]">Template Catalog</h2><p className="text-xs text-[var(--text-soft)]">Select a known-good detection pattern.</p></div>
          <select className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={kind} onChange={(e) => setKind(e.target.value as never)}><option value="all">All kinds</option><option value="detection">Detection</option><option value="correlation">Correlation</option><option value="escalation">Escalation</option><option value="helper">Helper</option><option value="parser_health">Parser health</option></select>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {templates.map((t) => (
              <button key={t.id} className={cx('w-full text-left p-2 rounded text-xs border transition-colors', selectedTemplate?.id === t.id && !selectedRule ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] hover:bg-[var(--panel-2)]')} onClick={() => { setSelectedTemplateId(t.id); setSelectedRuleId(''); }}>
                <div className="font-semibold text-[var(--text)]">{t.name}</div>
                <div className="text-[var(--text-soft)] mt-0.5">{t.kind} · L{t.level} · {t.useCaseId}</div>
              </button>
            ))}
          </div>
        </SurfaceCard>
        <SurfaceCard className="lg:col-span-2 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div><h2 className="text-sm font-bold text-[var(--text)]">Generated Rule XML</h2><p className="text-xs text-[var(--text-soft)]">Review-only. Copy/download to use in Wazuh.</p></div>
            <div className="flex gap-2">
              <Button className="text-xs" onClick={() => { void copyToClipboard(xml); }}>Copy XML</Button>
              <Button className="text-xs" onClick={() => downloadText(`rule-${draft.ruleId}.xml`, xml, 'application/xml')}>Download</Button>
            </div>
          </div>
          {collision && <div className="rounded border border-destructive/25 bg-destructive/10 p-2 text-xs text-destructive">Rule ID {draft.ruleId} already exists. Choose a different ID.</div>}
          <SubtleCard className="flex flex-wrap gap-2 p-2">
            <Select className="text-xs" size="sm" value={selectedRuleId} onChange={(e) => setSelectedRuleId(e.target.value)}><option value="">Template mode</option>{data.rules.slice(0, 500).map((r) => <option key={r.id} value={r.id}>Clone {r.id}</option>)}</Select>
            <Input className="h-8 flex-1 text-xs" value={customRuleId} onChange={(e) => setCustomRuleId(e.target.value)} placeholder={`Rule ID · suggested ${suggestedId}`} />
            <Select className="text-xs" size="sm" value={status} onChange={(e) => setStatus(e.target.value)}><option>testing</option><option>production</option><option>experimental</option><option>deprecated</option></Select>
          </SubtleCard>
          <pre className="text-xs text-[var(--text)] bg-[var(--panel-2)] rounded-lg p-4 overflow-x-auto font-mono whitespace-pre-wrap max-h-80">{xml}</pre>
          <details className="text-xs">
            <summary className="text-[var(--accent)] cursor-pointer font-semibold">QA Skeleton</summary>
            <pre className="text-xs text-[var(--text)] bg-[var(--panel-2)] rounded-lg p-4 mt-2 overflow-x-auto font-mono whitespace-pre-wrap">{qa}</pre>
          </details>
        </SurfaceCard>
      </div>
    </div>
  );
}

// ---- Rule Composer ----
function RuleComposerCenter({ data, useCases }: { data: ParsedCollection; useCases: UseCaseRecord[] }) {
  const useCaseOptions = useMemo(() => {
    const seen = new Set<string>();
    [...useCases.map((u) => u.id), ...data.rules.map((r) => r.useCaseId).filter(Boolean)].forEach((id) => seen.add(id));
    return [...seen].filter((id) => id && id !== 'unassigned').sort();
  }, [data.rules, useCases]);
  const existingIds = useMemo(() => new Set(data.rules.map((r) => r.id)), [data.rules]);
  const nextSuggestedId = useMemo(() => {
    const nums = data.rules.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
    const max = nums.length ? Math.max(...nums) : 100000;
    for (let n = max + 1; n < max + 1000; n++) if (!existingIds.has(String(n))) return String(n);
    return String(max + 1);
  }, [data.rules, existingIds]);

  const [ruleId, setRuleId] = useState(nextSuggestedId);
  const [level, setLevel] = useState('7');
  const [description, setDescription] = useState('Custom detection rule');
  const [useCaseId, setUseCaseId] = useState(useCaseOptions[0] || 'uc_fgt_custom_detection');
  const [status, setStatus] = useState('testing');
  const [dependencyType, setDependencyType] = useState<'none' | 'if_sid' | 'if_group' | 'if_matched_sid' | 'if_matched_group' | 'decoded_as'>('if_sid');
  const [dependencyValue, setDependencyValue] = useState('45080');
  const [fieldName, setFieldName] = useState('event.action');
  const [fieldPattern, setFieldPattern] = useState('(?i)deny|blocked|dropped');
  const [mitre, setMitre] = useState('');
  const [frequency, setFrequency] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [extraGroups, setExtraGroups] = useState('custom_detection');

  const idCollision = ruleId.trim() !== '' && existingIds.has(ruleId.trim());
  const levelNum = Number(level);
  const role = frequency || timeframe || dependencyType.includes('matched') ? 'correlation' : levelNum >= 11 ? 'escalation' : levelNum === 0 ? 'helper' : 'detection';
  const jira = levelNum >= 11 ? 'jira_visible' : 'jira_hidden';
  const mitreIds = mitre.split(/[\s,]+/).map((m) => m.trim().toUpperCase()).filter(Boolean);
  const selectedUseCase = getUseCaseById(useCases, useCaseId);
  const componentGroup = (selectedUseCase?.component || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const groups = [status, `${componentGroup}_custom`, useCaseId, `role_${role}`, jira, ...extraGroups.split(',').map((g) => g.trim()).filter(Boolean)];
  const depLine = dependencyType === 'none' ? '' : dependencyType === 'decoded_as' ? `  <decoded_as>${dependencyValue}</decoded_as>\n` : `  <${dependencyType}>${dependencyValue}</${dependencyType}>\n`;
  const fieldLine = fieldName.trim() && fieldPattern.trim() ? `  <field name="${fieldName.trim()}" type="pcre2">${fieldPattern.trim()}</field>\n` : '';
  const freqAttrs = `${frequency ? ` frequency="${frequency}"` : ''}${timeframe ? ` timeframe="${timeframe}"` : ''}`;
  const mitreBlock = mitreIds.length ? `  <mitre>\n${mitreIds.map((id) => `    <id>${id}</id>`).join('\n')}\n  </mitre>\n` : '';
  const xml = `<rule id="${ruleId.trim() || nextSuggestedId}" level="${level || '0'}"${freqAttrs}>\n${depLine}${fieldLine}  <description>${description.trim() || 'Custom Wazuh rule'}</description>\n  <options>no_full_log</options>\n  <info type="text">use_case:${useCaseId}</info>\n  <group>${groups.join(',')},</group>\n${mitreBlock}</rule>`;

  const warnings = [
    idCollision && `Rule ID ${ruleId} already exists.`,
    levelNum >= 11 && !mitreIds.length && 'Jira-visible rule has no MITRE mapping.',
    dependencyType !== 'none' && !dependencyValue.trim() && 'Dependency type selected but no value provided.',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SurfaceCard className="p-4 space-y-4">
          <div><h2 className="text-sm font-bold text-[var(--text)]">Visual Rule Builder</h2><p className="text-xs text-[var(--text-soft)]">Build Wazuh-safe XML from structured fields. Review-only — nothing is auto-written.</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Rule ID</label><input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={ruleId} onChange={(e) => setRuleId(e.target.value)} /></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Level</label><input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={level} onChange={(e) => setLevel(e.target.value)} /></div>
            <div className="col-span-2"><label className="text-xs text-[var(--text-soft)] block mb-1">Description</label><input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Dependency type</label><select className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={dependencyType} onChange={(e) => setDependencyType(e.target.value as never)}><option value="none">none</option><option value="if_sid">if_sid</option><option value="if_group">if_group</option><option value="if_matched_sid">if_matched_sid</option><option value="if_matched_group">if_matched_group</option><option value="decoded_as">decoded_as</option></select></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Dependency value</label><input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={dependencyValue} onChange={(e) => setDependencyValue(e.target.value)} /></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Field name</label><input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={fieldName} onChange={(e) => setFieldName(e.target.value)} /></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Field pattern</label><input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={fieldPattern} onChange={(e) => setFieldPattern(e.target.value)} /></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Frequency</label><input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="optional" /></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Timeframe (sec)</label><input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={timeframe} onChange={(e) => setTimeframe(e.target.value)} placeholder="optional" /></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">MITRE IDs</label><input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={mitre} onChange={(e) => setMitre(e.target.value)} placeholder="T1110,T1133" /></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Extra groups</label><input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={extraGroups} onChange={(e) => setExtraGroups(e.target.value)} /></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Status</label><select className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={status} onChange={(e) => setStatus(e.target.value)}><option>testing</option><option>production</option><option>experimental</option><option>deprecated</option></select></div>
            <div><label className="text-xs text-[var(--text-soft)] block mb-1">Use Case</label><select className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] w-full" value={useCaseId} onChange={(e) => setUseCaseId(e.target.value)}>{useCaseOptions.map((u) => <option key={u} value={u}>{ucName(useCases, u)} ({u})</option>)}<option value="uc_fgt_custom_detection">Custom Detection (uc_fgt_custom_detection)</option></select></div>
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div><h2 className="text-sm font-bold text-[var(--text)]">Generated XML</h2><p className="text-xs text-[var(--text-soft)]">Copy/download for use.</p></div>
            <div className="flex gap-2">
              <Button className="text-xs" onClick={() => { void copyToClipboard(xml); }}>Copy</Button>
              <Button className="text-xs" onClick={() => downloadText(`rule-${ruleId || 'new'}.xml`, xml, 'application/xml')}>Download</Button>
            </div>
          </div>
          {warnings.length > 0 && <div className="space-y-1">{warnings.map((w) => <div key={w} className="rounded border border-[color:var(--warning)]/25 bg-[color:var(--warning)]/12 p-2 text-xs text-[color:var(--warning)]">{w}</div>)}</div>}
          <div className="flex gap-2 text-xs">
            <Badge tone="muted">{role}</Badge>
            <Badge tone="warning">{jira}</Badge>
            <Badge tone="info">{useCaseId}</Badge>
          </div>
          <pre className="text-xs text-[var(--text)] bg-[var(--panel-2)] rounded-lg p-4 overflow-x-auto font-mono whitespace-pre-wrap max-h-96">{xml}</pre>
        </SurfaceCard>
      </div>
    </div>
  );
}

// ---- Use Case Studio ----
function UseCaseStudio({
  useCases,
  currentUser,
  onCreate,
  onDelete,
}: {
  useCases: UseCaseRecord[];
  currentUser?: CurrentUser;
  onCreate: (useCase: UseCaseRecord) => Promise<void>;
  onDelete: (useCaseId: string) => Promise<void>;
}) {
  const existingIds = useMemo(() => new Set(useCases.map((useCase) => useCase.id)), [useCases]);
  const [component] = useState('Global');
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [product, setProduct] = useState('');
  const [domain, setDomain] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const suggestedId = useMemo(() => editingId || buildUseCaseId(component, name, existingIds), [component, editingId, name, existingIds]);
  const creator = currentUser?.name || currentUser?.email || currentUser?.id || 'Unknown user';
  const filtered = useMemo(() => useCases.filter((useCase) => {
    if (!query.trim()) return true;
    const hay = `${useCase.id} ${useCase.name} ${useCase.shortName} ${useCase.component} ${useCase.category} ${useCase.createdBy}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  }), [query, useCases]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setShortName('');
    setProduct('');
    setDomain('');
    setCategory('');
    setDescription('');
  };

  const submit = async () => {
    if (!name.trim()) return;
    const existing = editingId ? useCases.find((useCase) => useCase.id === editingId) : undefined;
    const record: UseCaseRecord = {
      id: suggestedId,
      name: name.trim(),
      shortName: shortName.trim() || name.trim(),
      component,
      vendor: component.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      product: product.trim() || component,
      domain: domain.trim() || 'SOC Detection Engineering',
      category: category.trim() || 'Custom',
      description: description.trim() || `${name.trim()} detection coverage.`,
      source: 'custom',
      createdBy: existing?.createdBy || creator,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    setSaving(true);
    try {
      await onCreate(record);
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(340px,420px)_1fr]">
        <SurfaceCard className="p-4 space-y-4">
          <div><h2 className="text-lg font-bold text-[var(--text)]">Use Case Studio</h2><p className="text-sm text-[var(--text-soft)]">Register global use cases once, get stable IDs like <code>uc_here_name_of_use</code>, then reference those IDs inside XML with <code>&lt;info type=&quot;text&quot;&gt;use_case:...&lt;/info&gt;</code>.</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel>Global ID</FieldLabel><Input className="w-full" value={suggestedId} readOnly /></div>
            <div><FieldLabel>Scope</FieldLabel><Input className="w-full" value="Global" readOnly /></div>
            <div className="col-span-2"><FieldLabel>Full name</FieldLabel><Input className="w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Azure impossible travel detection" /></div>
            <div><FieldLabel>Short name</FieldLabel><Input className="w-full" value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Impossible Travel" /></div>
            <div><FieldLabel>Category</FieldLabel><Input className="w-full" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Identity & Access" /></div>
            <div><FieldLabel>Product</FieldLabel><Input className="w-full" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Microsoft Entra ID" /></div>
            <div><FieldLabel>Domain</FieldLabel><Input className="w-full" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Cloud Identity" /></div>
            <div className="col-span-2"><FieldLabel>Description</FieldLabel><Textarea className="w-full min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What telemetry and detections belong in this use case?" /></div>
          </div>
          <div className="flex gap-2">
            <Button tone="primary" onClick={() => { void submit(); }} disabled={!name.trim() || saving}>{saving ? 'Saving...' : editingId ? 'Update use case' : 'Create use case'}</Button>
            {editingId ? <Button onClick={resetForm} disabled={saving}>Cancel edit</Button> : null}
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-4 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div><h2 className="text-lg font-bold text-[var(--text)]">Catalog</h2><p className="text-sm text-[var(--text-soft)]">Search IDs, copy them into XML, and see who created each use case.</p></div>
            <Badge tone="muted">{filtered.length} shown</Badge>
          </div>
          <Input className="w-full" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ID, name, creator..." />
          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1 custom-scrollbar">
            {filtered.map((useCase) => (
              <div key={useCase.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-[var(--text)]">{useCase.name}</div>
                    <div className="text-xs font-medium text-[var(--text)]">{useCase.id}</div>
                    <div className="text-xs text-[var(--text-soft)]">Global · {useCase.category}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button className="text-xs" onClick={() => { void copyToClipboard(useCase.id); }}>Copy ID</Button>
                    {useCase.source === 'custom' ? <Button className="text-xs" onClick={() => {
                      setEditingId(useCase.id);
                      setName(useCase.name);
                      setShortName(useCase.shortName);
                      setProduct(useCase.product);
                      setDomain(useCase.domain);
                      setCategory(useCase.category);
                      setDescription(useCase.description);
                    }}>Edit</Button> : null}
                    {useCase.source === 'custom' ? <Button tone="danger" className="text-xs" onClick={() => { void onDelete(useCase.id); if (editingId === useCase.id) resetForm(); }}>Delete</Button> : null}
                  </div>
                </div>
                <p className="text-xs text-[var(--text-soft)]">{useCase.description}</p>
                <div className="flex flex-wrap gap-2 text-xs text-[var(--text-soft)]">
                  <Badge tone="muted">{useCase.product}</Badge>
                  <Badge tone="muted">{useCase.domain}</Badge>
                  <Badge tone="muted">{useCase.source}</Badge>
                  <Badge tone="muted">Created by {useCase.createdBy}</Badge>
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}

// ---- Use Case Tree ----
function UseCaseTree({ data, useCases, onSelect }: { data: ParsedCollection; useCases: UseCaseRecord[]; onSelect: (s: Selected) => void }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filterSource, setFilterSource] = useState('all');
  const grouped = useMemo(() => {
    const map = new Map<string, RuleRecord[]>();
    const queryText = deferredQuery.toLowerCase();
    data.rules.forEach((r) => {
      const uc = getUseCaseById(useCases, r.useCaseId);
      const hay = `${r.useCaseId} ${uc?.name || ''} ${uc?.description || ''} ${uc?.component || ''} ${uc?.category || ''} ${r.role} ${r.status}`.toLowerCase();
      const matchesQuery = !queryText || hay.includes(queryText);
      const matchesSource = filterSource === 'all' || (uc?.source || 'unknown') === filterSource;
      if (matchesQuery && matchesSource) {
        map.set(r.useCaseId, [...(map.get(r.useCaseId) || []), r]);
      }
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data.rules, filterSource, deferredQuery, useCases]);
  const paged = usePagedRows(grouped);
  return (
    <SurfaceCard className="p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold text-[var(--text)]">Use Case Tree</h2><p className="text-sm text-[var(--text-soft)]">Use case to helper, detection, correlation, and Jira-visible rules.</p></div>
        <Badge tone="muted">{grouped.length} use cases</Badge>
      </div>
      <SubtleCard className="!flex !flex-row !flex-nowrap items-center gap-2 overflow-x-auto p-3">
        <Input className="h-9 w-[260px] min-w-[260px] shrink-0 text-xs" placeholder="Search use case, id, role, status..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select className="h-9 min-w-[140px] shrink-0 text-xs font-semibold" value={filterSource} onChange={(e) => setFilterSource(e.target.value)}><option value="all">All sources</option><option value="custom">Custom</option><option value="builtin">Built-in</option></Select>
      </SubtleCard>
      <PageControls total={grouped.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
      <div className="space-y-3">
        {paged.pageRows.map(([id, rules]) => {
          const uc = getUseCaseById(useCases, id);
          const byRole = new Map<string, RuleRecord[]>(); rules.forEach((r) => byRole.set(r.role, [...(byRole.get(r.role) || []), r]));
          return (
            <div key={id} className="border border-[var(--border)] rounded-lg p-3">
              <div className="font-semibold text-[var(--text)]">{uc?.name || id}</div>
              <div className="text-xs font-medium text-[var(--text)]">{id}</div>
              <div className="text-xs text-[var(--text-soft)]">{rules.length} rules · {rules.filter(r => r.jiraVisible).length} Jira · {rules.filter(r => r.useCaseConfidence === 'confirmed').length} confirmed</div>
              <p className="text-xs text-[var(--text-soft)] mt-1">{uc?.description || 'No professional registry record yet.'}</p>
              <div className="text-xs text-[var(--text-soft)] mt-1">Created by {uc?.createdBy || 'Unknown'} · {uc?.source || 'unknown'}</div>
              <div className="space-y-2 mt-3">
                {[...byRole.entries()].sort().map(([role, rs]) => (
                  <div key={role}>
                    <div className="text-xs font-semibold text-[var(--text-soft)] uppercase">{role} ({rs.length})</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {rs.slice(0, 15).map((r) => <button key={r.id} className="text-xs font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline px-1.5 py-0.5 rounded hover:bg-[var(--accent-soft)]" onClick={() => onSelect({ type: 'rule', item: r })}>{r.id}</button>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <PageControls total={grouped.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
    </SurfaceCard>
  );
}

// ---- Coverage Map ----
function CoverageMapView({ data, useCases }: { data: ParsedCollection; useCases: UseCaseRecord[] }) {
  const summary = useMemo(() => buildRulePackCoverage(data, useCases), [data, useCases]);
  const paged = usePagedRows(summary.rows);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI label="Use Cases" value={summary.stats.useCases} sub="active" tone="cyan" />
        <KPI label="Strong" value={summary.stats.strong} sub="score ≥ 82" tone="green" />
        <KPI label="Good" value={summary.stats.good} sub="score 66-81" tone="cyan" />
        <KPI label="Weak" value={summary.stats.weak} sub="score 40-65" tone="amber" />
        <KPI label="Missing" value={summary.stats.missing} sub="score &lt; 40" tone="red" />
        <KPI label="Avg Score" value={`${summary.stats.averageScore}/100`} sub={`${summary.stats.jiraVisibleRules} Jira rules`} tone="purple" />
      </div>
      <SurfaceCard className="p-4 md:p-5 space-y-4">
        <div><h2 className="text-lg font-bold text-[var(--text)]">Rule Pack Coverage Map</h2><p className="text-sm text-[var(--text-soft)]">Use-case scoring across detection depth, MITRE, decoder, QA, Jira, and standardization dimensions.</p></div>
        <PageControls total={summary.rows.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-soft)] uppercase tracking-wider"><th className="p-2">Use Case</th><th className="p-2">Score</th><th className="p-2">Rules</th><th className="p-2">Jira</th><th className="p-2">MITRE</th><th className="p-2">Weak Signals</th></tr></thead>
            <tbody>
              {paged.pageRows.map((row) => (
                <tr key={row.useCaseId} className="border-b border-[var(--border)]">
                  <td className="p-2 text-[var(--text)] font-medium">{row.name}</td>
                  <td className="p-2"><span className={cx('rounded-md px-2 py-0.5 text-xs font-semibold', row.status === 'strong' ? statusPillClass('success') : row.status === 'good' ? statusPillClass('info') : row.status === 'weak' ? statusPillClass('warning') : statusPillClass('danger'))}>{row.score} · {row.status}</span></td>
                  <td className="p-2 text-[var(--text)]">{row.rules} ({row.detections}d · {row.correlations}c)</td>
                  <td className="p-2 text-[var(--text)]">{row.jiraVisible}</td>
                  <td className="p-2"><div className="flex flex-wrap gap-1">{row.mitreTechniques.slice(0, 4).map((m) => <Chip kind="mitre" key={m}>{m}</Chip>)}</div></td>
                  <td className="p-2 text-xs text-[var(--text-soft)]">{row.weakSignals.join(', ') || 'none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PageControls total={summary.rows.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
      </SurfaceCard>
    </div>
  );
}

// ---- Quality Scores ----
function QualityScoresView({ data, onSelect }: { data: ParsedCollection; onSelect: (s: Selected) => void }) {
  const summary = useMemo(() => buildQualitySummary(data), [data]);
  const paged = usePagedRows(summary.rules);
  const ruleById = useMemo(() => new Map(data.rules.map((rule) => [rule.id, rule])), [data.rules]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI label="Avg Score" value={`${summary.stats.averageOverall}/100`} sub="overall quality" tone="cyan" />
        <KPI label="Excellent" value={summary.stats.excellent} sub="score ≥ 88" tone="green" />
        <KPI label="Good" value={summary.stats.good} sub="score 74-87" tone="cyan" />
        <KPI label="Needs Review" value={summary.stats.needsReview} sub="score 58-73" tone="amber" />
        <KPI label="Risky" value={summary.stats.risky} sub="score 40-57" tone="red" />
        <KPI label="Broken" value={summary.stats.broken} sub="score &lt; 40" tone="red" />
      </div>
      <SurfaceCard className="p-4 md:p-5 space-y-4">
        <div><h2 className="text-lg font-bold text-[var(--text)]">Rule Quality Scores</h2><p className="text-sm text-[var(--text-soft)]">8-dimension scoring per rule. Click a rule to inspect.</p></div>
        <PageControls total={summary.rules.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-soft)] uppercase tracking-wider"><th className="p-2">Rule</th><th className="p-2">Score</th><th className="p-2">Grade</th><th className="p-2">Use Case</th><th className="p-2">Level</th><th className="p-2">Role</th><th className="p-2">Warnings</th></tr></thead>
            <tbody>
              {paged.pageRows.map((r) => (
                <tr key={r.ruleId} className="border-b border-[var(--border)] hover:bg-[var(--accent-soft)] cursor-pointer" onClick={() => { const rule = ruleById.get(r.ruleId); if (rule) onSelect({ type: 'rule', item: rule }); }}>
                  <td className="p-2"><span className="font-mono text-xs font-medium text-[var(--text)]">{r.ruleId}</span></td>
                  <td className="p-2"><span className={cx('font-semibold', r.overall >= 88 ? 'text-emerald-700 dark:text-emerald-400' : r.overall >= 74 ? 'text-sky-700 dark:text-sky-400' : r.overall >= 58 ? 'text-[color:var(--warning)]' : r.overall >= 40 ? 'text-orange-700 dark:text-orange-400' : 'text-destructive')}>{r.overall}</span></td>
                  <td className="p-2"><span className={cx('rounded-md border px-2 py-0.5 text-xs font-semibold', r.grade === 'excellent' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : r.grade === 'good' ? 'border-sky-600/35 bg-sky-600/15 text-sky-800 dark:text-sky-200' : r.grade === 'needs_review' ? 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300' : r.grade === 'risky' ? 'border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'border-destructive/25 bg-destructive/10 text-destructive')}>{r.grade}</span></td>
                  <td className="p-2 text-[var(--text)]">{r.useCaseId}</td>
                  <td className="p-2 text-[var(--text)]">{r.level}</td>
                  <td className="p-2 text-[var(--text)]">{r.role}</td>
                  <td className="p-2 text-xs text-[var(--text-soft)] max-w-xs">{r.warnings.slice(0, 2).join('; ') || 'none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PageControls total={summary.rules.length} page={paged.page} totalPages={paged.totalPages} start={paged.start} end={paged.end} setPage={paged.setPage} />
      </SurfaceCard>
    </div>
  );
}

// ---- Field Intelligence ----
function FieldIntelView({ data }: { data: ParsedCollection }) {
  const intel = useMemo(() => buildFieldIntelligence(data), [data]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Total Fields" value={intel.stats.totalFields} sub="discovered" tone="cyan" />
        <KPI label="Produced" value={intel.stats.producedFields} sub="by decoders" tone="purple" />
        <KPI label="Used" value={intel.stats.usedFields} sub="by rules" tone="green" />
        <KPI label="Avg Risk" value={`${intel.stats.averageRisk}/100`} sub="field criticality" tone="amber" />
      </div>
      <SurfaceCard className="p-4 md:p-5 space-y-4">
        <div><h2 className="text-lg font-bold text-[var(--text)]">Field Intelligence</h2><p className="text-sm text-[var(--text-soft)]">Lineage, aliases, impossible fields, and risk scoring.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-soft)] uppercase tracking-wider"><th className="p-2">Field</th><th className="p-2">Health</th><th className="p-2">Risk</th><th className="p-2">Family</th><th className="p-2">Produced By</th><th className="p-2">Used By</th></tr></thead>
            <tbody>
              {intel.rows.slice(0, 60).map((r) => (
                <tr key={r.field} className="border-b border-[var(--border)]">
                  <td className="p-2"><span className="font-mono text-xs font-medium text-[var(--text)]">{r.field}</span></td>
                  <td className="p-2"><span className={cx('rounded-md px-2 py-0.5 text-xs font-semibold', r.health === 'healthy' ? statusPillClass('success') : r.health === 'unknown_source' ? statusPillClass('warning') : r.health === 'orphaned' ? statusPillClass('danger') : statusPillClass('muted'))}>{r.health}</span></td>
                  <td className="p-2"><span className={cx('font-semibold', r.riskScore >= 60 ? 'text-destructive' : r.riskScore >= 35 ? 'text-[color:var(--warning)]' : 'text-[var(--text-soft)]')}>{r.riskScore}</span></td>
                  <td className="p-2 text-[var(--text)]">{r.family}</td>
                  <td className="p-2 text-xs text-[var(--text-soft)]">{r.producedBy.slice(0, 3).join(', ') || 'none'}</td>
                  <td className="p-2 text-xs text-[var(--text-soft)]">{r.usedByRules.length} rules</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}

// ---- Search ----
function SearchView({ data, onSelect }: { data: ParsedCollection; onSelect: (s: Selected) => void }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => q.trim() ? searchParsedCollection(data, q) : null, [data, q]);
  return (
    <SurfaceCard className="p-4 md:p-5 space-y-4">
      <div><h2 className="text-lg font-bold text-[var(--text)]">Enterprise Search</h2><p className="text-sm text-[var(--text-soft)]">Search across rules, decoders, files, and issues. Use field:value syntax: id:45100, level:{">="}10, usecase:uc_fgt_vpn_auth, severity:critical, decoder:fortigate-firewall, mitre:T1110</p></div>
      <Input className="w-full" placeholder="Search everything... (use id:, level:, usecase:, mitre:, status:, role:, decoder:, field:, jira:, severity:, file:)" value={q} onChange={(e) => setQ(e.target.value)} />
      {results && (
        <div className="space-y-2">
          <div className="flex gap-2 text-xs text-[var(--text-soft)]">
            <Badge tone="muted">{results.summary.rules} rules</Badge>
            <Badge tone="muted">{results.summary.decoders} decoders</Badge>
            <Badge tone="muted">{results.summary.files} files</Badge>
            <Badge tone="muted">{results.summary.issues} issues</Badge>
          </div>
          {results.rules.slice(0, 30).map((r) => (
            <div key={r.id} className="border border-[var(--border)] rounded-lg p-2 flex items-center gap-3 cursor-pointer hover:bg-[var(--accent-soft)]" onClick={() => onSelect({ type: 'rule', item: r })}>
              <span className="font-mono text-xs text-[var(--accent)]">{r.id}</span>
              <span className="text-sm text-[var(--text)] truncate flex-1">{r.description}</span>
              <span className="text-xs text-[var(--text-soft)]">{r.useCaseId}</span>
            </div>
          ))}
          {results.decoders.slice(0, 20).map((d, i) => (
            <div key={`${d.name}-${i}`} className="border border-[var(--border)] rounded-lg p-2 flex items-center gap-3 cursor-pointer hover:bg-[var(--accent-soft)]" onClick={() => onSelect({ type: 'decoder', item: d })}>
              <span className="font-mono text-xs text-[var(--primary)]">{d.name}</span>
              <span className="text-sm text-[var(--text)]">{d.orderFields.join(', ')}</span>
            </div>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

// ---- AI Intelligence ----
function AiIntelView({ data }: { data: ParsedCollection }) {
  const [mode, setMode] = useState<'explain' | 'quality' | 'tuning' | 'executive'>('explain');
  const [targetId, setTargetId] = useState('');
  const result = useMemo<AiAnalysisResult | null>(() => {
    if (data.rules.length === 0) return null;
    const targetType = targetId && data.rules.some((r) => r.id === targetId) ? 'rule' as const : 'collection' as const;
    return buildAiAnalysis({ targetType, mode, targetId: targetType === 'rule' ? targetId : undefined, collection: data });
  }, [data, mode, targetId]);

  return (
    <SurfaceCard className="p-4 md:p-5 space-y-4">
      <div><h2 className="text-lg font-bold text-[var(--text)]">Rule Analysis</h2><p className="text-sm text-[var(--text-soft)]">Deterministic analysis with explanations, quality scoring, and tuning guidance.</p></div>
      <SubtleCard className="flex flex-wrap gap-2 p-3">
        <Select value={mode} onChange={(e) => setMode(e.target.value as never)}><option value="explain">Explain</option><option value="quality">Quality</option><option value="tuning">Tuning</option><option value="executive">Executive</option></Select>
        <input className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)] placeholder-[var(--text-soft)] flex-1" placeholder="Rule ID (optional — leave empty for collection-wide)" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
        <select className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1.5 text-sm text-[var(--text)]" onChange={(e) => { const v = e.target.value; if (v) setTargetId(v); }} value=""><option value="">Quick select rule</option>{data.rules.slice(0, 200).map((r) => <option key={r.id} value={r.id}>{r.id} · {r.description.slice(0, 60)}</option>)}</select>
      </SubtleCard>
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-[var(--text)]">{result.title}</span>
            <Badge tone="muted">{result.targetType}</Badge>
            <span className={cx('text-lg font-bold', result.score >= 80 ? 'text-emerald-700 dark:text-emerald-400' : result.score >= 60 ? 'text-[var(--accent)]' : result.score >= 40 ? 'text-[color:var(--warning)]' : 'text-destructive')}>{result.score}/100</span>
          </div>
          <p className="text-sm text-[var(--text)] whitespace-pre-wrap">{result.summary}</p>
          {result.findings.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[var(--text-soft)] uppercase">Findings</div>
              {result.findings.map((f, i) => (
                <div key={i} className="border border-[var(--border)] rounded p-2 flex items-start gap-2">
                  <span className={cx('mt-0.5 rounded px-1.5 py-0.5 text-xs font-semibold', f.severity === 'critical' ? statusPillClass('danger') : f.severity === 'high' ? 'border border-orange-500/25 bg-orange-500/12 text-orange-700 dark:text-orange-400' : f.severity === 'medium' ? statusPillClass('warning') : statusPillClass('muted'))}>{f.severity}</span>
                  <div><div className="text-sm font-semibold text-[var(--text)]">{f.title}</div><div className="text-xs text-[var(--text-soft)]">{f.detail}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-[var(--text-soft)] italic">Upload rules to enable AI analysis.</div>
      )}
    </SurfaceCard>
  );
}

// ---- Roundtrip ----
function RoundtripView({ data }: { data: ParsedCollection }) {
  const analysis = useMemo(() => analyzeXmlRoundtrip(data), [data]);
  const report = useMemo(() => buildRoundtripMarkdownReport(data, analysis), [data, analysis]);
  return (
    <SurfaceCard className="p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold text-[var(--text)]">XML Roundtrip Analysis</h2><p className="text-sm text-[var(--text-soft)]">Parser accuracy, source sections, commented-out rules, group flow, and patch suggestions.</p></div>
        <Button className="text-xs" onClick={() => { void copyToClipboard(report); }}>Copy Report</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Source Sections" value={analysis.sourceSections.length} sub="detected" tone="cyan" />
        <KPI label="Commented Rules" value={analysis.commentedRules.length} sub="found" tone="purple" />
        <KPI label="Group Flows" value={analysis.groupFlows.length} sub="active/orphan" tone="green" />
        <KPI label="Patch Suggestions" value={analysis.missingUseCaseSuggestions.length} sub="available" tone={analysis.missingUseCaseSuggestions.length ? 'amber' : 'green'} />
      </div>
      <pre className="text-xs text-[var(--text)] bg-[var(--panel-2)] rounded-lg p-4 overflow-x-auto font-mono whitespace-pre-wrap max-h-96">{report}</pre>
    </SurfaceCard>
  );
}

// ===================================================================
// MAIN WazuhRulesHub COMPONENT
// ===================================================================
export default function WazuhRulesHub({ currentUser, initialCustomUseCases = [] }: { currentUser?: CurrentUser; initialCustomUseCases?: UseCaseRecord[] }) {
  const restored = useMemo(() => restoreGraphCollection(), []);
  const [customUseCases, setCustomUseCases] = useState<UseCaseRecord[]>(initialCustomUseCases);
  const useCaseCatalog = useMemo(() => mergeUseCases(customUseCases), [customUseCases]);
  const [data, setData] = useState<ParsedCollection>(restored);
  const [files, setFiles] = useState<UploadedFile[]>(restored.files);
  const filesRef = useRef<UploadedFile[]>(restored.files);
  const [view, setView] = useState<ActiveView>(data.files.length ? 'graph' : 'upload');
  const [selected, setSelected] = useState<Selected>(null);
  const [selectedTenant, setSelectedTenant] = useState(ALL_TENANTS);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [managerStatus, setManagerStatus] = useState<ManagerArchiveStatus>({
    rootPath: null,
    archiveCount: 0,
    fileCount: restored.files.length,
    phase: 'idle',
    errors: [],
  });

  useEffect(() => {
    try {
      sessionStorage.removeItem(GRAPH_COLLECTION_KEY);
      localStorage.removeItem(GRAPH_COLLECTION_KEY);
    } catch {}
  }, []);

  const handleFilesLoaded = useCallback((uploaded: UploadedFile[], persist = true) => {
    setFiles(uploaded);
    filesRef.current = uploaded;
    const parsed = parseCollection(uploaded, useCaseCatalog);
    setData(parsed);
    if (persist) rememberGraphCollection(parsed);
    if (uploaded.length > 0) setView('graph');
  }, [useCaseCatalog]);

  const refreshManagerFiles = useCallback(async () => {
    setBusy(true);
    setManagerStatus((current) => ({
      ...current,
      phase: 'scanning',
      completedArchives: 0,
      completedXmlFiles: 0,
      totalArchives: undefined,
      totalXmlFiles: undefined,
      currentArchive: undefined,
      cached: false,
      errors: [],
    }));
    try {
      const response = await fetch('/api/manager-files/stream', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Manager source refresh failed (${response.status})`);
      if (!response.body) throw new Error('Manager source stream unavailable');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamedFiles: UploadedFile[] = [];

      const handleEvent = (event: ManagerStreamEvent) => {
        if (event.type === 'start') {
          setManagerStatus({
            rootPath: event.rootPath,
            archiveCount: event.archives.length,
            fileCount: 0,
            completedArchives: 0,
            completedXmlFiles: 0,
            totalArchives: event.totalArchives,
            totalXmlFiles: event.totalXmlFiles,
            phase: event.cached ? 'ready' : 'extracting',
            cached: event.cached,
            loadedAt: event.loadedAt,
            fingerprint: event.fingerprint,
            errors: event.errors,
          });
          return;
        }

        if (event.type === 'archive') {
          streamedFiles = [...streamedFiles, ...event.files];
          filesRef.current = streamedFiles;
          setManagerStatus((current) => ({
            ...current,
            archiveCount: event.totalArchives,
            fileCount: streamedFiles.length,
            completedArchives: event.completedArchives,
            completedXmlFiles: event.completedXmlFiles,
            totalArchives: event.totalArchives,
            totalXmlFiles: event.totalXmlFiles,
            currentArchive: event.archive.name,
            phase: 'extracting',
            errors: event.errors,
          }));
          return;
        }

        if (event.type === 'archive-error') {
          setManagerStatus((current) => ({
            ...current,
            completedArchives: event.completedArchives,
            completedXmlFiles: event.completedXmlFiles,
            totalArchives: event.totalArchives,
            totalXmlFiles: event.totalXmlFiles,
            currentArchive: event.archive.name,
            phase: 'extracting',
            errors: event.errors,
          }));
          return;
        }

        if (event.type === 'done') {
          streamedFiles = event.files;
          setManagerStatus({
            rootPath: event.rootPath,
            archiveCount: event.archives.length,
            fileCount: event.files.length,
            completedArchives: event.archives.length,
            completedXmlFiles: event.files.length,
            totalArchives: event.archives.length,
            totalXmlFiles: event.files.length,
            phase: 'ready',
            cached: event.cached,
            loadedAt: event.loadedAt,
            fingerprint: event.fingerprint,
            errors: event.errors,
          });
          if (event.files.length > 0) handleFilesLoaded(event.files, true);
          else if (!filesRef.current.length) setData(empty);
          return;
        }

        if (event.type === 'error') {
          throw new Error(event.error);
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
          if (!rawLine.trim()) continue;
          handleEvent(JSON.parse(rawLine) as ManagerStreamEvent);
        }
        if (done) break;
      }
      if (buffer.trim()) {
        handleEvent(JSON.parse(buffer) as ManagerStreamEvent);
      }
    } catch (error) {
      setManagerStatus((current) => ({
        ...current,
        phase: 'error',
        errors: [error instanceof Error ? error.message : 'Failed to refresh manager source'],
      }));
    } finally {
      setBusy(false);
    }
  }, [handleFilesLoaded]);

  useEffect(() => {
    if (!files.length) {
      filesRef.current = files;
      setData((prev) => prev.files.length ? parseCollection(prev.files, useCaseCatalog) : empty);
      return;
    }
    const parsed = parseCollection(files, useCaseCatalog);
    filesRef.current = files;
    setData(parsed);
    rememberGraphCollection(parsed);
  }, [files, useCaseCatalog]);

  useEffect(() => {
    void refreshManagerFiles();
    const interval = window.setInterval(() => {
      void refreshManagerFiles();
    }, MANAGER_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refreshManagerFiles]);

  const handleCreateUseCase = async (useCase: UseCaseRecord) => {
    const response = await fetch('/api/use-cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(useCase),
    });
    if (!response.ok) throw new Error('Failed to save use case');
    const payload = await response.json() as { useCases: UseCaseRecord[] };
    setCustomUseCases(payload.useCases);
  };

  const handleDeleteUseCase = async (useCaseId: string) => {
    const response = await fetch('/api/use-cases', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: useCaseId }),
    });
    if (!response.ok) throw new Error('Failed to delete use case');
    const payload = await response.json() as { useCases: UseCaseRecord[] };
    setCustomUseCases(payload.useCases);
  };

  const handleFileList = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      handleFilesLoaded(await readUploadedFiles(list));
    } finally {
      setBusy(false);
    }
  };

  const hasData = data.files.length > 0;
  const tenants = useMemo(() => (
    [...new Set(data.files.map((file) => getRecordTenant(file)))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  ), [data.files]);
  const displayData = useMemo(() => buildTenantScopedCollection(data, selectedTenant, useCaseCatalog), [data, selectedTenant, useCaseCatalog]);
  const canOpenView = (id: ActiveView) => hasData || ['upload', 'useCaseStudio'].includes(id);
  const activeView = NAV_VIEWS.find((item) => item.id === view) || NAV_VIEWS[0];

  useEffect(() => {
    if (selectedTenant !== ALL_TENANTS && !tenants.includes(selectedTenant)) {
      setSelectedTenant(ALL_TENANTS);
    }
  }, [selectedTenant, tenants]);

  useEffect(() => {
    setSelected(null);
  }, [selectedTenant]);

  return (
    <div className="app-theme-unify app-surface-stack">
      <div className={cx('app-workspace-shell', sidebarCollapsed && 'is-sidebar-collapsed')}>
        <aside className="app-sidebar">
          <div className="app-tab-rail">
            <div className="app-sidebar-heading">
              <div className="app-sidebar-heading-copy">
                <span>Navigation</span>
                <strong>Rules Hub</strong>
              </div>
              <button
                type="button"
                className="app-sidebar-collapse"
                onClick={() => setSidebarCollapsed((current) => !current)}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </button>
            </div>
            <div className="app-sidebar-sections custom-scrollbar">
              {NAV_GROUPS.map((group) => {
                const groupViews = NAV_VIEWS.filter((v) => v.group === group);
                return (
                  <div key={group} className="app-tab-group">
                    <span className="app-tab-group-label">{group}</span>
                    {groupViews.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          if (!canOpenView(v.id)) return;
                          setView(v.id);
                        }}
                        className={cx('app-tab-button', view === v.id ? 'is-active' : !canOpenView(v.id) ? 'is-disabled' : undefined)}
                        title={v.desc}
                      >
                        <v.icon className="app-tab-icon" />
                        <span className="app-tab-label">{v.label}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="app-sidebar-footer">
              <span className={cx('workspace-status-dot', managerStatus.phase === 'error' ? 'is-error' : managerStatus.phase === 'ready' ? 'is-ready' : 'is-busy')} />
              <div><strong>{managerStatus.phase === 'ready' ? 'Source connected' : managerStatus.phase === 'error' ? 'Source error' : 'Source syncing'}</strong><span>{fmt(managerStatus.fileCount)} XML files</span></div>
            </div>
          </div>
        </aside>

        <div className="app-workspace-content">
          {view === 'command' ? <RulesHubTopBar
            data={displayData}
            rawData={data}
            hasData={hasData}
            busy={busy}
            managerStatus={managerStatus}
            tenants={tenants}
            selectedTenant={selectedTenant}
            onTenantChange={setSelectedTenant}
            onRefreshManager={() => { void refreshManagerFiles(); }}
            onLoadFiles={handleFileList}
          /> : null}
          {view !== 'command' ? <div className="app-view-heading">
            <div className="app-view-title">
              <span className="app-view-title-icon"><activeView.icon /></span>
              <div>
                <span>{activeView.group}</span>
                <h2>{activeView.label}</h2>
              </div>
            </div>
            <div className="app-view-actions">
              {hasData ? (
                <Select className="h-9 min-w-[190px] text-xs font-semibold" value={selectedTenant} onChange={(event) => setSelectedTenant(event.target.value)} aria-label="Client scope">
                  <option value={ALL_TENANTS}>All clients (deduped)</option>
                  {tenants.map((tenant) => <option key={tenant} value={tenant}>{tenantLabel(tenant)}</option>)}
                </Select>
              ) : null}
              <Button className="h-9" onClick={() => { void refreshManagerFiles(); }} disabled={busy}>{busy ? 'Refreshing...' : 'Refresh source'}</Button>
            </div>
          </div> : null}
          <div className="app-view-content">
          {view === 'upload' && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,420px)_1fr]">
              <UploadCard onLoaded={handleFilesLoaded} files={files} />
              {!hasData ? <EmptyGraphWorkbench onLoadFiles={handleFileList} onRefreshManager={() => { void refreshManagerFiles(); }} busy={busy} /> : <DependencyGraph data={displayData} useCases={useCaseCatalog} onSelect={setSelected} />}
            </div>
          )}
          {view === 'useCaseStudio' && <UseCaseStudio useCases={useCaseCatalog} currentUser={currentUser} onCreate={handleCreateUseCase} onDelete={handleDeleteUseCase} />}
          {view === 'command' && hasData && <CommandCenter data={displayData} />}
          {view === 'rules' && hasData && <RuleExplorer data={displayData} onSelect={setSelected} />}
          {view === 'decoders' && hasData && <DecoderExplorer data={displayData} onSelect={setSelected} />}
          {view === 'fields' && hasData && <FieldCoverageMatrix data={displayData} onSelect={setSelected} />}
          {view === 'graph' && hasData && <DependencyGraph data={displayData} useCases={useCaseCatalog} onSelect={setSelected} />}
          {view === 'mitre' && hasData && <MitreView data={displayData} onSelect={setSelected} />}
          {view === 'validation' && hasData && <ValidationCenter data={displayData} />}
          {view === 'files' && hasData && <FilesView data={displayData} />}
          {view === 'templates' && hasData && <RuleTemplateLibraryCenter data={displayData} onSelect={setSelected} />}
          {view === 'composer' && hasData && <RuleComposerCenter data={displayData} useCases={useCaseCatalog} />}
          {view === 'usecases' && hasData && <UseCaseTree data={displayData} useCases={useCaseCatalog} onSelect={setSelected} />}
          {view === 'coverage' && hasData && <CoverageMapView data={displayData} useCases={useCaseCatalog} />}
          {view === 'quality' && hasData && <QualityScoresView data={displayData} onSelect={setSelected} />}
          {view === 'fieldIntel' && hasData && <FieldIntelView data={displayData} />}
          {view === 'search' && hasData && <SearchView data={displayData} onSelect={setSelected} />}
          {view === 'ai' && hasData && <AiIntelView data={displayData} />}
          {view === 'roundtrip' && hasData && <RoundtripView data={displayData} />}

          {!hasData && !['upload', 'useCaseStudio'].includes(view) && (
            <SurfaceCard className="p-8 text-center space-y-4">
              <h2 className="text-lg font-bold text-[var(--text)]">No files loaded</h2>
              <p className="text-sm text-[var(--text-soft)]">Upload rule or decoder XML files to continue.</p>
              <Button tone="primary" onClick={() => setView('upload')}>Go to Upload</Button>
            </SurfaceCard>
          )}
          </div>
        </div>
      </div>

      {/* Inspector drawer */}
      {selected && <Drawer selected={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
