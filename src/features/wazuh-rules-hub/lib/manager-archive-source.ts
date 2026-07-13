import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tenantFromArchiveName } from './tenants';
import type { UploadedFile } from './types';

export type ManagerArchiveSnapshot = {
  rootPath: string | null;
  configured: boolean;
  archives: ManagerArchiveInfo[];
  files: UploadedFile[];
  fingerprint: string;
  loadedAt: string;
  errors: string[];
};

export type ManagerArchiveInfo = {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  xmlFiles: number;
};

export type ManagerArchiveWorkItem = ManagerArchiveInfo & { entries: string[] };

export type ManagerArchiveManifest = {
  rootPath: string | null;
  configured: boolean;
  archives: ManagerArchiveInfo[];
  workItems: ManagerArchiveWorkItem[];
  fingerprint: string;
  loadedAt: string;
  errors: string[];
};

const DEFAULT_MANAGER_ARCHIVE_DIR = '/opt/mercure/siem-managers';
const ARCHIVE_EXTENSIONS = ['.tar.gz', '.tgz'];
const XML_SOURCE_RE = /(^|\/)(rules|decoders)\/[^/]+\.xml$/i;
const TAR_EXTRACT_CHUNK_SIZE = 100;

let cachedSnapshot: ManagerArchiveSnapshot | null = null;

const getManagerArchiveDir = () => {
  const configured = process.env.SIEM_MANAGERS_DIR || process.env.NEXT_PUBLIC_SIEM_MANAGERS_DIR;
  return configured?.trim() || DEFAULT_MANAGER_ARCHIVE_DIR;
};

const runTar = (args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn('tar', args, { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString('utf8') || `tar exited with code ${code}`));
    });
  });

const isManagerXmlPath = (entry: string) => {
  const normalized = entry.replaceAll('\\', '/').replace(/^\.?\//, '');
  if (normalized.includes('../') || path.isAbsolute(normalized)) return false;
  return XML_SOURCE_RE.test(normalized);
};

const inferFileType = (name: string, content: string): UploadedFile['type'] => {
  const lower = `${name}\n${content.slice(0, 2000)}`.toLowerCase();
  if (lower.includes('<decoder') || lower.includes('decoders')) return 'decoders';
  if (lower.includes('<rule') || lower.includes('rules')) return 'rules';
  return 'unknown';
};

const hashFile = (name: string, content: string) =>
  createHash('sha256').update(`${name}:${content}`).digest('hex');

const listArchiveXmlEntries = async (archivePath: string) => {
  const output = await runTar(['-tzf', archivePath]);
  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter(isManagerXmlPath)
    .sort((a, b) => a.localeCompare(b));
};

const extractArchiveEntries = async (archivePath: string, entries: string[]) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rules-hub-managers-'));
  try {
    for (let index = 0; index < entries.length; index += TAR_EXTRACT_CHUNK_SIZE) {
      const chunk = entries.slice(index, index + TAR_EXTRACT_CHUNK_SIZE);
      await runTar(['-xzf', archivePath, '-C', tempDir, ...chunk]);
    }

    const contents: Array<{ entry: string; content: string }> = [];
    for (const entry of entries) {
      const entryPath = path.join(tempDir, ...entry.replaceAll('\\', '/').split('/'));
      contents.push({ entry, content: await readFile(entryPath, 'utf8') });
    }
    return contents;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const buildFingerprint = (archives: ManagerArchiveSnapshot['archives']) =>
  createHash('sha256')
    .update(JSON.stringify(archives.map((archive) => [archive.name, archive.size, archive.modifiedAt, archive.xmlFiles])))
    .digest('hex');

export async function readManagerArchiveFiles(archive: ManagerArchiveWorkItem): Promise<UploadedFile[]> {
  const extracted = await extractArchiveEntries(archive.path, archive.entries);
  const tenant = tenantFromArchiveName(archive.name);
  return extracted.map(({ entry, content }) => {
    const sourceName = `${archive.name}/${entry}`;
    return {
      name: sourceName,
      tenant,
      size: Buffer.byteLength(content, 'utf8'),
      type: inferFileType(sourceName, content),
      content,
      hash: hashFile(sourceName, content),
    };
  });
}

export async function readManagerArchiveManifest(): Promise<ManagerArchiveManifest> {
  const rootPath = getManagerArchiveDir();
  const loadedAt = new Date().toISOString();
  const errors: string[] = [];
  const workItems: ManagerArchiveWorkItem[] = [];
  const archives: ManagerArchiveInfo[] = [];

  try {
    const rootStat = await stat(rootPath);
    if (!rootStat.isDirectory()) {
      return {
        rootPath,
        configured: Boolean(rootPath),
        archives,
        workItems,
        fingerprint: '',
        loadedAt,
        errors: [`${rootPath} is not a directory.`],
      };
    }
  } catch (error) {
    return {
      rootPath,
      configured: Boolean(rootPath),
      archives,
      workItems,
      fingerprint: '',
      loadedAt,
      errors: [error instanceof Error ? error.message : `Cannot read ${rootPath}.`],
    };
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const archiveNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => ARCHIVE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension)))
    .sort((a, b) => a.localeCompare(b));

  for (const archiveName of archiveNames) {
    const archivePath = path.join(rootPath, archiveName);
    try {
      const archiveStat = await stat(archivePath);
      const xmlEntries = await listArchiveXmlEntries(archivePath);
      const archive = {
        name: archiveName,
        path: archivePath,
        size: archiveStat.size,
        modifiedAt: archiveStat.mtime.toISOString(),
        xmlFiles: xmlEntries.length,
      };
      archives.push(archive);
      workItems.push({ ...archive, entries: xmlEntries });
    } catch (error) {
      errors.push(`${archiveName}: ${error instanceof Error ? error.message : 'failed to inspect archive'}`);
    }
  }

  const fingerprint = buildFingerprint(archives);
  return { rootPath, configured: Boolean(rootPath), archives, workItems, fingerprint, loadedAt, errors };
}

export function getCachedManagerArchiveSnapshot(rootPath: string | null, fingerprint: string): ManagerArchiveSnapshot | null {
  if (cachedSnapshot?.rootPath === rootPath && cachedSnapshot.fingerprint === fingerprint) {
    return cachedSnapshot;
  }
  return null;
}

export function rememberManagerArchiveSnapshot(snapshot: ManagerArchiveSnapshot) {
  cachedSnapshot = snapshot;
}

export async function readManagerArchiveSnapshot(): Promise<ManagerArchiveSnapshot> {
  const manifest = await readManagerArchiveManifest();
  const cached = getCachedManagerArchiveSnapshot(manifest.rootPath, manifest.fingerprint);
  if (cached) return { ...cached, loadedAt: manifest.loadedAt };

  const files: UploadedFile[] = [];
  const errors = [...manifest.errors];

  for (const archive of manifest.workItems) {
    try {
      files.push(...await readManagerArchiveFiles(archive));
    } catch (error) {
      errors.push(`${archive.name}: ${error instanceof Error ? error.message : 'failed to extract archive XML'}`);
    }
  }

  const snapshot = {
    rootPath: manifest.rootPath,
    configured: manifest.configured,
    archives: manifest.archives,
    files,
    fingerprint: manifest.fingerprint,
    loadedAt: manifest.loadedAt,
    errors,
  };
  rememberManagerArchiveSnapshot(snapshot);
  return snapshot;
}
