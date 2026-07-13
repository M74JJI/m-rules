export const ALL_TENANTS = 'all';
export const MANUAL_TENANT = 'manual';

export const tenantFromArchiveName = (archiveName: string) =>
  archiveName.replace(/\.tar\.gz$/i, '').replace(/\.tgz$/i, '').trim() || MANUAL_TENANT;

export const tenantFromSourceName = (sourceName: string) => {
  const root = sourceName.split(/[\\/]/)[0]?.trim();
  return root ? tenantFromArchiveName(root) : MANUAL_TENANT;
};

export const getRecordTenant = (record: { tenant?: string; sourceFile?: string; name?: string; fileName?: string }) =>
  record.tenant || tenantFromSourceName(record.sourceFile || record.fileName || record.name || MANUAL_TENANT);
