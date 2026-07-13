export type UploadedFile = {
  name: string;
  tenant?: string;
  size: number;
  type: 'rules' | 'decoders' | 'unknown';
  content: string;
  hash: string;
};

export type RuleDependency = {
  type: 'if_sid' | 'if_group' | 'if_matched_sid' | 'if_matched_group' | 'decoded_as';
  value: string;
};

export type RuleField = {
  name: string;
  type?: string;
  value: string;
};

export type RuleRecord = {
  id: string;
  level: number;
  description: string;
  groups: string[];
  status: string;
  role: string;
  severity: string;
  jiraVisible: boolean;
  tenant?: string;
  sourceFile: string;
  sourceSection?: string;
  useCaseId: string;
  useCaseConfidence: 'confirmed' | 'inferred' | 'unassigned';
  mitre: string[];
  dependencies: RuleDependency[];
  fields: RuleField[];
  frequency?: string;
  timeframe?: string;
  decodedAs?: string[];
  options: string[];
  rawXml: string;
};

export type DecoderRecord = {
  name: string;
  parent?: string;
  prematch?: string[];
  regex: string[];
  orderFields: string[];
  tenant?: string;
  sourceFile: string;
  rawXml: string;
};

export type UseCaseRecord = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  component: string;
  vendor: string;
  product: string;
  domain: string;
  category: string;
  source: 'system' | 'custom';
  createdBy: string;
  createdAt?: string;
};

export type ValidationIssue = {
  severity: 'error' | 'warning' | 'info';
  type: string;
  title: string;
  detail: string;
  ruleId?: string;
  decoderName?: string;
  fileName?: string;
  tenant?: string;
};

export type ParsedCollection = {
  files: UploadedFile[];
  rules: RuleRecord[];
  decoders: DecoderRecord[];
  useCases: UseCaseRecord[];
  issues: ValidationIssue[];
  stats: {
    rules: number;
    decoders: number;
    useCases: number;
    jiraVisible: number;
    testing: number;
    production: number;
    critical: number;
    mitreMapped: number;
    missingUseCase: number;
    brokenDependencies: number;
  };
};
