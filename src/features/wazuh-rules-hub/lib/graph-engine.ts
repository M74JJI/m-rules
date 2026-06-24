import type { DecoderRecord, ParsedCollection, RuleRecord } from './types';
import { buildDecoderIntelligence } from './field-matrix';

export type GraphMode = 'rules' | 'decoders' | 'decoder_rules' | 'use_cases' | 'mitre' | 'fields' | 'all';
export type GraphLayout = 'layered' | 'radial';

export type GraphNodeType = 'root' | 'rule' | 'decoder' | 'use_case' | 'mitre' | 'field' | 'group' | 'external';
export type GraphEdgeType = 'if_sid' | 'if_group' | 'if_matched_sid' | 'if_matched_group' | 'decoded_as' | 'decoder_parent' | 'field_produces' | 'field_uses' | 'use_case' | 'mitre' | 'contains';

export type GraphNode = {
  id: string;
  label: string;
  subtitle: string;
  type: GraphNodeType;
  tone: 'cyan' | 'purple' | 'green' | 'amber' | 'red' | 'slate';
  size: number;
  weight: number;
  rule?: RuleRecord;
  decoder?: DecoderRecord;
  meta?: Record<string, string | number | boolean>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  label: string;
  weight: number;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodes: number;
    edges: number;
    rules: number;
    decoders: number;
    fields: number;
    useCases: number;
    mitre: number;
    external: number;
  };
};

export type GraphFilters = {
  mode: GraphMode;
  query: string;
  useCaseId: string;
  status: string;
  role: string;
  jiraOnly: boolean;
  includeExternal: boolean;
  limit: number;
};

const toneForRule = (rule: RuleRecord): GraphNode['tone'] => {
  if (rule.jiraVisible || rule.severity === 'critical') return 'red';
  if (rule.role === 'correlation') return 'amber';
  if (rule.role === 'helper') return 'slate';
  if (rule.role === 'parser_health') return 'green';
  return 'cyan';
};

const addNode = (map: Map<string, GraphNode>, node: GraphNode) => {
  const existing = map.get(node.id);
  if (!existing || node.weight > existing.weight) map.set(node.id, node);
};

const addEdge = (map: Map<string, GraphEdge>, edge: GraphEdge) => {
  if (edge.source === edge.target) return;
  map.set(edge.id, edge);
};

const hayRule = (r: RuleRecord) => `${r.id} ${r.description} ${r.groups.join(' ')} ${r.mitre.join(' ')} ${r.useCaseId} ${r.status} ${r.role} ${r.fields.map((f) => `${f.name} ${f.value}`).join(' ')}`.toLowerCase();
const hayDecoder = (d: DecoderRecord) => `${d.name} ${d.parent || ''} ${d.orderFields.join(' ')} ${d.regex.join(' ')} ${d.prematch?.join(' ') || ''}`.toLowerCase();

const filterRules = (data: ParsedCollection, filters: GraphFilters) => {
  const q = filters.query.trim().toLowerCase();
  return data.rules.filter((r) => {
    if (filters.useCaseId !== 'all' && r.useCaseId !== filters.useCaseId) return false;
    if (filters.status !== 'all' && r.status !== filters.status) return false;
    if (filters.role !== 'all' && r.role !== filters.role) return false;
    if (filters.jiraOnly && !r.jiraVisible) return false;
    if (q && !hayRule(r).includes(q)) return false;
    return true;
  });
};

const ruleImportance = (r: RuleRecord) => (r.jiraVisible ? 1000 : 0) + (r.severity === 'critical' ? 500 : 0) + (r.role === 'correlation' ? 200 : 0) + r.level * 8 + r.dependencies.length + r.mitre.length;

export function buildGraphData(data: ParsedCollection, filters: GraphFilters): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const allRuleMap = new Map(data.rules.map((r) => [r.id, r]));
  const decoderMap = new Map(data.decoders.map((d) => [d.name, d]));
  const filteredRules = filterRules(data, filters).sort((a, b) => ruleImportance(b) - ruleImportance(a)).slice(0, filters.limit);
  const filteredRuleIds = new Set(filteredRules.map((r) => r.id));
  const q = filters.query.trim().toLowerCase();

  const putRule = (r: RuleRecord) => addNode(nodes, {
    id: `rule:${r.id}`,
    label: r.id,
    subtitle: `L${r.level} · ${r.role} · ${r.description.slice(0, 56)}`,
    type: 'rule',
    tone: toneForRule(r),
    size: r.jiraVisible ? 2 : r.role === 'correlation' ? 1.7 : r.role === 'helper' ? 1 : 1.35,
    weight: ruleImportance(r),
    rule: r,
  });
  const putDecoder = (d: DecoderRecord) => addNode(nodes, {
    id: `decoder:${d.name}`,
    label: d.name,
    subtitle: `${d.parent ? `parent ${d.parent}` : 'root decoder'} · ${d.orderFields.length} fields`,
    type: 'decoder',
    tone: 'purple',
    size: Math.min(2, 1 + d.orderFields.length / 20),
    weight: 100 + d.orderFields.length,
    decoder: d,
  });
  const putExternal = (kind: string, value: string) => addNode(nodes, {
    id: `external:${kind}:${value}`,
    label: value,
    subtitle: `external / not uploaded · ${kind}`,
    type: 'external',
    tone: 'slate',
    size: 0.9,
    weight: 1,
  });

  if (filters.mode === 'rules' || filters.mode === 'all') {
    for (const r of filteredRules) putRule(r);
    for (const r of filteredRules) {
      for (const dep of r.dependencies) {
        if (dep.type === 'if_sid' || dep.type === 'if_matched_sid') {
          const parent = allRuleMap.get(dep.value);
          if (parent && (filteredRuleIds.has(parent.id) || filters.mode === 'all')) putRule(parent);
          else if (filters.includeExternal) putExternal(dep.type, dep.value);
          const source = parent ? `rule:${dep.value}` : `external:${dep.type}:${dep.value}`;
          if (nodes.has(source)) addEdge(edges, { id: `${source}->rule:${r.id}:${dep.type}`, source, target: `rule:${r.id}`, type: dep.type, label: dep.type, weight: dep.type.includes('matched') ? 2 : 1 });
        }
        if ((dep.type === 'if_group' || dep.type === 'if_matched_group') && filters.includeExternal) {
          const groupId = `group:${dep.value}`;
          addNode(nodes, { id: groupId, label: dep.value, subtitle: dep.type, type: 'group', tone: 'green', size: 1, weight: 30 });
          addEdge(edges, { id: `${groupId}->rule:${r.id}:${dep.type}`, source: groupId, target: `rule:${r.id}`, type: dep.type, label: dep.type, weight: 1 });
        }
      }
    }
  }

  if (filters.mode === 'decoders' || filters.mode === 'all') {
    const decoders = data.decoders.filter((d) => !q || hayDecoder(d).includes(q)).slice(0, filters.limit);
    for (const d of decoders) putDecoder(d);
    for (const d of decoders) if (d.parent) {
      const parent = decoderMap.get(d.parent);
      if (parent) putDecoder(parent); else if (filters.includeExternal) putExternal('decoder_parent', d.parent);
      const source = parent ? `decoder:${d.parent}` : `external:decoder_parent:${d.parent}`;
      if (nodes.has(source)) addEdge(edges, { id: `${source}->decoder:${d.name}`, source, target: `decoder:${d.name}`, type: 'decoder_parent', label: 'parent', weight: 1 });
    }
  }

  if (filters.mode === 'decoder_rules' || filters.mode === 'fields' || filters.mode === 'all') {
    const intel = buildDecoderIntelligence(data);
    for (const link of intel.decoderLinks.slice(0, filters.limit)) {
      if (q && !`${link.decoderName} ${link.producedFields.join(' ')}`.toLowerCase().includes(q) && !link.directRules.some((r) => hayRule(r).includes(q)) && !link.fieldMatchedRules.some((r) => hayRule(r).includes(q))) continue;
      if (link.decoder) putDecoder(link.decoder);
      const decoderId = `decoder:${link.decoderName}`;
      for (const rule of [...link.directRules, ...link.fieldMatchedRules].filter((r, idx, arr) => arr.findIndex((x) => x.id === r.id) === idx).slice(0, 80)) {
        if (filters.useCaseId !== 'all' && rule.useCaseId !== filters.useCaseId) continue;
        if (filters.jiraOnly && !rule.jiraVisible) continue;
        putRule(rule);
        if (nodes.has(decoderId)) addEdge(edges, { id: `${decoderId}->rule:${rule.id}:decoded`, source: decoderId, target: `rule:${rule.id}`, type: 'decoded_as', label: link.directRules.includes(rule) ? 'decoded_as' : 'field match', weight: link.directRules.includes(rule) ? 2 : 1 });
      }
      if (filters.mode === 'fields') {
        for (const field of link.producedFields.slice(0, 14)) {
          const fieldId = `field:${field}`;
          addNode(nodes, { id: fieldId, label: field, subtitle: 'decoded field', type: 'field', tone: 'cyan', size: 1, weight: 20 });
          if (nodes.has(decoderId)) addEdge(edges, { id: `${decoderId}->${fieldId}`, source: decoderId, target: fieldId, type: 'field_produces', label: 'produces', weight: 1 });
          const usedRules = intel.usedFieldMap.get(field) || [];
          for (const r of usedRules.slice(0, 20)) {
            if (filters.useCaseId !== 'all' && r.useCaseId !== filters.useCaseId) continue;
            if (filters.jiraOnly && !r.jiraVisible) continue;
            putRule(r);
            addEdge(edges, { id: `${fieldId}->rule:${r.id}`, source: fieldId, target: `rule:${r.id}`, type: 'field_uses', label: 'used by', weight: 1 });
          }
        }
      }
    }
  }

  if (filters.mode === 'use_cases' || filters.mode === 'all') {
    const rules = filteredRules;
    const useCaseIds = [...new Set(rules.map((r) => r.useCaseId))].filter(Boolean).slice(0, 80);
    for (const id of useCaseIds) {
      const uc = data.useCases.find((x) => x.id === id);
      const ucRules = rules.filter((r) => r.useCaseId === id);
      const ucId = `usecase:${id}`;
      addNode(nodes, { id: ucId, label: uc?.shortName || id, subtitle: `${id} · ${ucRules.length} rules`, type: 'use_case', tone: 'green', size: Math.min(2.3, 1.2 + ucRules.length / 40), weight: 200 + ucRules.length });
      for (const r of ucRules.slice(0, 80)) { putRule(r); addEdge(edges, { id: `${ucId}->rule:${r.id}`, source: ucId, target: `rule:${r.id}`, type: 'use_case', label: 'contains', weight: 1 }); }
    }
  }

  if (filters.mode === 'mitre' || filters.mode === 'all') {
    for (const r of filteredRules.filter((r) => r.mitre.length)) {
      putRule(r);
      for (const m of r.mitre) {
        const mid = `mitre:${m}`;
        addNode(nodes, { id: mid, label: m, subtitle: 'MITRE ATT&CK technique', type: 'mitre', tone: 'amber', size: 1.2, weight: 120 });
        addEdge(edges, { id: `${mid}->rule:${r.id}`, source: mid, target: `rule:${r.id}`, type: 'mitre', label: 'maps', weight: 1 });
      }
    }
  }

  const nodeArr = [...nodes.values()].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  const allowed = new Set(nodeArr.map((n) => n.id));
  const edgeArr = [...edges.values()].filter((e) => allowed.has(e.source) && allowed.has(e.target));
  return {
    nodes: nodeArr,
    edges: edgeArr,
    stats: {
      nodes: nodeArr.length,
      edges: edgeArr.length,
      rules: nodeArr.filter((n) => n.type === 'rule').length,
      decoders: nodeArr.filter((n) => n.type === 'decoder').length,
      fields: nodeArr.filter((n) => n.type === 'field').length,
      useCases: nodeArr.filter((n) => n.type === 'use_case').length,
      mitre: nodeArr.filter((n) => n.type === 'mitre').length,
      external: nodeArr.filter((n) => n.type === 'external' || n.type === 'group').length,
    },
  };
}

export type PositionedNode = GraphNode & { x: number; y: number };

const nodeSize = (node: GraphNode) => ({
  width: node.type === 'decoder' ? 250 : node.type === 'rule' ? 210 : 200,
  height: node.type === 'field' ? 48 : 58,
});

const normalizeCanvas = (nodes: PositionedNode[], edges: GraphEdge[], minWidth: number, minHeight: number) => {
  if (!nodes.length) return { nodes, edges, width: minWidth, height: minHeight };
  const pad = 120;
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + nodeSize(node).width));
  const maxY = Math.max(...nodes.map((node) => node.y + nodeSize(node).height));
  const shiftX = Math.max(0, pad - minX);
  const shiftY = Math.max(0, pad - minY);
  const shifted = nodes.map((node) => ({ ...node, x: node.x + shiftX, y: node.y + shiftY }));
  return {
    nodes: shifted,
    edges,
    width: Math.max(minWidth, maxX + shiftX + pad),
    height: Math.max(minHeight, maxY + shiftY + pad),
  };
};

export function layoutGraph(graph: GraphData, layout: GraphLayout, width = 1800, height = 1100): { nodes: PositionedNode[]; edges: GraphEdge[]; width: number; height: number } {
  if (layout === 'radial') {
    const cx = width / 2;
    const cy = height / 2;
    const groups = new Map<GraphNodeType, GraphNode[]>();
    for (const node of graph.nodes) groups.set(node.type, [...(groups.get(node.type) || []), node]);
    const ringOrder: GraphNodeType[] = ['use_case', 'mitre', 'decoder', 'field', 'group', 'external', 'rule'];
    const positioned: PositionedNode[] = [];
    ringOrder.forEach((type, ring) => {
      const items = groups.get(type) || [];
      const radius = 110 + ring * 118;
      items.forEach((node, i) => {
        const angle = (Math.PI * 2 * i) / Math.max(items.length, 1) - Math.PI / 2 + ring * .18;
        const size = nodeSize(node);
        positioned.push({ ...node, x: cx + Math.cos(angle) * radius - size.width / 2, y: cy + Math.sin(angle) * radius - size.height / 2 });
      });
    });
    return normalizeCanvas(positioned, graph.edges, width, height);
  }

  const typeOrder: GraphNodeType[] = ['use_case', 'mitre', 'decoder', 'field', 'group', 'external', 'rule'];
  const positioned: PositionedNode[] = [];
  const marginX = 90;
  const gapX = 245;
  for (const [col, type] of typeOrder.entries()) {
    const items = graph.nodes.filter((n) => n.type === type);
    const gapY = Math.max(74, Math.min(145, (height - 120) / Math.max(items.length, 1)));
    items.forEach((node, i) => positioned.push({ ...node, x: marginX + col * gapX, y: 70 + i * gapY }));
  }
  const neededHeight = Math.max(height, 160 + Math.max(...positioned.map((n) => n.y), 0));
  return normalizeCanvas(positioned, graph.edges, Math.max(width, marginX * 2 + typeOrder.length * gapX), neededHeight);
}
