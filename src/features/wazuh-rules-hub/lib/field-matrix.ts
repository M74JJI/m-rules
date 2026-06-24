import type { DecoderRecord, ParsedCollection, RuleField, RuleRecord } from './types';

export type FieldMatrixStatus = 'covered' | 'rule_only' | 'decoder_only';

export type FieldMatrixRow = {
  field: string;
  status: FieldMatrixStatus;
  producedBy: DecoderRecord[];
  usedByRules: RuleRecord[];
  useCaseIds: string[];
  jiraVisibleRules: number;
  criticalRules: number;
};

export type DecoderRuleLink = {
  decoderName: string;
  decoder?: DecoderRecord;
  directRules: RuleRecord[];
  fieldMatchedRules: RuleRecord[];
  producedFields: string[];
};

export type DecoderIntelligence = {
  producedFieldMap: Map<string, DecoderRecord[]>;
  usedFieldMap: Map<string, RuleRecord[]>;
  matrixRows: FieldMatrixRow[];
  decoderLinks: DecoderRuleLink[];
  orphanRuleFields: FieldMatrixRow[];
  orphanDecoderFields: FieldMatrixRow[];
  topFieldsByRuleUsage: FieldMatrixRow[];
  stats: {
    producedFields: number;
    usedFields: number;
    coveredFields: number;
    ruleOnlyFields: number;
    decoderOnlyFields: number;
    decodedAsLinks: number;
  };
};

const normalizeFieldName = (value: string) => value.trim().replace(/^\.+|\.+$/g, '').toLowerCase();

const isRealRuleField = (field: RuleField) => {
  const name = normalizeFieldName(field.name);
  if (!name || name === 'match') return false;
  if (name === 'same_field' || name === 'different_field') return !!field.value;
  return true;
};

const fieldNameFromRuleField = (field: RuleField) => {
  const name = normalizeFieldName(field.name);
  if (name === 'same_field' || name === 'different_field') return normalizeFieldName(field.value);
  return name;
};

const addToMap = <T>(map: Map<string, T[]>, key: string, item: T) => {
  const normalized = normalizeFieldName(key);
  if (!normalized) return;
  const existing = map.get(normalized) || [];
  if (!existing.includes(item)) map.set(normalized, [...existing, item]);
};

export function buildDecoderIntelligence(data: ParsedCollection): DecoderIntelligence {
  const producedFieldMap = new Map<string, DecoderRecord[]>();
  const usedFieldMap = new Map<string, RuleRecord[]>();

  for (const decoder of data.decoders) {
    for (const field of decoder.orderFields) addToMap(producedFieldMap, field, decoder);
  }

  for (const rule of data.rules) {
    for (const field of rule.fields) {
      if (!isRealRuleField(field)) continue;
      addToMap(usedFieldMap, fieldNameFromRuleField(field), rule);
    }
  }

  const allFields = new Set([...producedFieldMap.keys(), ...usedFieldMap.keys()]);
  const matrixRows: FieldMatrixRow[] = [...allFields].map((field) => {
    const producedBy = producedFieldMap.get(field) || [];
    const usedByRules = usedFieldMap.get(field) || [];
    const useCaseIds = [...new Set(usedByRules.map((r) => r.useCaseId))].sort();
    const status: FieldMatrixStatus = producedBy.length && usedByRules.length ? 'covered' : producedBy.length ? 'decoder_only' : 'rule_only';
    return {
      field,
      status,
      producedBy,
      usedByRules,
      useCaseIds,
      jiraVisibleRules: usedByRules.filter((r) => r.jiraVisible).length,
      criticalRules: usedByRules.filter((r) => r.severity === 'critical').length,
    };
  }).sort((a, b) => {
    const score = (row: FieldMatrixRow) => row.jiraVisibleRules * 1000 + row.criticalRules * 500 + row.usedByRules.length * 10 + row.producedBy.length;
    return score(b) - score(a) || a.field.localeCompare(b.field);
  });

  const decoderLinks: DecoderRuleLink[] = data.decoders.map((decoder) => {
    const directRules = data.rules.filter((rule) => rule.decodedAs?.includes(decoder.name) || rule.dependencies.some((d) => d.type === 'decoded_as' && d.value === decoder.name));
    const fieldSet = new Set(decoder.orderFields.map(normalizeFieldName).filter(Boolean));
    const fieldMatchedRules = data.rules.filter((rule) => rule.fields.some((field) => isRealRuleField(field) && fieldSet.has(fieldNameFromRuleField(field))));
    return {
      decoderName: decoder.name,
      decoder,
      directRules,
      fieldMatchedRules,
      producedFields: [...fieldSet].sort(),
    };
  }).sort((a, b) => (b.directRules.length + b.fieldMatchedRules.length) - (a.directRules.length + a.fieldMatchedRules.length) || a.decoderName.localeCompare(b.decoderName));

  const orphanRuleFields = matrixRows.filter((row) => row.status === 'rule_only');
  const orphanDecoderFields = matrixRows.filter((row) => row.status === 'decoder_only');
  const topFieldsByRuleUsage = [...matrixRows].sort((a, b) => b.usedByRules.length - a.usedByRules.length || b.jiraVisibleRules - a.jiraVisibleRules).slice(0, 60);
  const decodedAsLinks = data.rules.reduce((count, rule) => count + (rule.decodedAs?.length || 0), 0);

  return {
    producedFieldMap,
    usedFieldMap,
    matrixRows,
    decoderLinks,
    orphanRuleFields,
    orphanDecoderFields,
    topFieldsByRuleUsage,
    stats: {
      producedFields: producedFieldMap.size,
      usedFields: usedFieldMap.size,
      coveredFields: matrixRows.filter((row) => row.status === 'covered').length,
      ruleOnlyFields: orphanRuleFields.length,
      decoderOnlyFields: orphanDecoderFields.length,
      decodedAsLinks,
    },
  };
}
