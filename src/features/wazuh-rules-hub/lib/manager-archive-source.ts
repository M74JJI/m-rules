import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { UploadedFile } from './types';

export type ManagerArchiveSnapshot = {
  rootPath: string | null;
  configured: boolean;
  archives: Array<{ name: string; path: string; size: number; modifiedAt: string; xmlFiles: number }>;
  files: UploadedFile[];
  fingerprint: string;
  loadedAt: string;
  errors: string[];
};

const DEFAULT_MANAGER_ARCHIVE_DIR = '/opt/mercure/siem-managers';
const ARCHIVE_EXTENSIONS = ['.tar.gz', '.tgz'];
const XML_SOURCE_RE = /(^|\/)(rules|decoders)\/[^/]+\.xml$/i;

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

const readArchiveEntry = async (archivePath: string, entry: string) => runTar(['-xOzf', archivePath, entry]);

export async function readManagerArchiveSnapshot(): Promise<ManagerArchiveSnapshot> {
  const rootPath = getManagerArchiveDir();
  const loadedAt = new Date().toISOString();
  const errors: string[] = [];
  const archives: ManagerArchiveSnapshot['archives'] = [];
  const files: UploadedFile[] = [];

  try {
    const rootStat = await stat(rootPath);
    if (!rootStat.isDirectory()) {
      return {
        rootPath,
        configured: Boolean(rootPath),
        archives,
        files,
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
      files,
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
      archives.push({
        name: archiveName,
        path: archivePath,
        size: archiveStat.size,
        modifiedAt: archiveStat.mtime.toISOString(),
        xmlFiles: xmlEntries.length,
      });

      for (const entry of xmlEntries) {
        try {
          const content = await readArchiveEntry(archivePath, entry);
          const sourceName = `${archiveName}/${entry}`;
          files.push({
            name: sourceName,
            size: Buffer.byteLength(content, 'utf8'),
            type: inferFileType(sourceName, content),
            content,
            hash: hashFile(sourceName, content),
          });
        } catch (error) {
          errors.push(`${archiveName}/${entry}: ${error instanceof Error ? error.message : 'failed to read entry'}`);
        }
      }
    } catch (error) {
      errors.push(`${archiveName}: ${error instanceof Error ? error.message : 'failed to inspect archive'}`);
    }
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify(archives.map((archive) => [archive.name, archive.size, archive.modifiedAt, archive.xmlFiles])))
    .digest('hex');

  return {
    rootPath,
    configured: Boolean(rootPath),
    archives,
    files,
    fingerprint,
    loadedAt,
    errors,
  };
}
