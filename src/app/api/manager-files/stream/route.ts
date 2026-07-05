import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  getCachedManagerArchiveSnapshot,
  readManagerArchiveFiles,
  readManagerArchiveManifest,
  rememberManagerArchiveSnapshot,
  type ManagerArchiveSnapshot,
} from '@/features/wazuh-rules-hub/lib/manager-archive-source';
import type { UploadedFile } from '@/features/wazuh-rules-hub/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function line(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return unauthorized();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (value: unknown) => controller.enqueue(encoder.encode(line(value)));
      try {
        const manifest = await readManagerArchiveManifest();
        const cached = getCachedManagerArchiveSnapshot(manifest.rootPath, manifest.fingerprint);
        const totalXmlFiles = manifest.archives.reduce((sum, archive) => sum + archive.xmlFiles, 0);
        write({
          type: 'start',
          rootPath: manifest.rootPath,
          archives: manifest.archives,
          totalArchives: manifest.archives.length,
          totalXmlFiles,
          fingerprint: manifest.fingerprint,
          loadedAt: manifest.loadedAt,
          errors: manifest.errors,
          cached: Boolean(cached),
        });

        if (cached) {
          write({ type: 'done', ...cached, loadedAt: manifest.loadedAt, cached: true });
          controller.close();
          return;
        }

        const files: UploadedFile[] = [];
        const errors = [...manifest.errors];
        let completedArchives = 0;
        let completedXmlFiles = 0;

        for (const archive of manifest.workItems) {
          try {
            const archiveFiles = await readManagerArchiveFiles(archive);
            files.push(...archiveFiles);
            completedArchives += 1;
            completedXmlFiles += archive.xmlFiles;
            write({
              type: 'archive',
              archive: {
                name: archive.name,
                size: archive.size,
                modifiedAt: archive.modifiedAt,
                xmlFiles: archive.xmlFiles,
              },
              files: archiveFiles,
              completedArchives,
              completedXmlFiles,
              totalArchives: manifest.archives.length,
              totalXmlFiles,
              errors,
            });
          } catch (error) {
            completedArchives += 1;
            errors.push(`${archive.name}: ${error instanceof Error ? error.message : 'failed to extract archive XML'}`);
            write({
              type: 'archive-error',
              archive: { name: archive.name, xmlFiles: archive.xmlFiles },
              completedArchives,
              completedXmlFiles,
              totalArchives: manifest.archives.length,
              totalXmlFiles,
              errors,
            });
          }
        }

        const snapshot: ManagerArchiveSnapshot = {
          rootPath: manifest.rootPath,
          configured: manifest.configured,
          archives: manifest.archives,
          files,
          fingerprint: manifest.fingerprint,
          loadedAt: manifest.loadedAt,
          errors,
        };
        rememberManagerArchiveSnapshot(snapshot);
        write({ type: 'done', ...snapshot, cached: false });
        controller.close();
      } catch (error) {
        write({ type: 'error', error: error instanceof Error ? error.message : 'Failed to stream manager archives' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
