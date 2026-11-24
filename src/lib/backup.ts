import type { AppDb } from '../db';

export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: 'calbou';
  version: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

const TABLES = ['settings', 'meals', 'myFoods', 'body', 'proposals', 'aiUsage', 'sheetMappings'] as const;

/** 全データをJSON化する。APIキーは別管理でありここには含めない。画像も存在しない。 */
export async function buildBackup(db: AppDb, now: Date = new Date()): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  return { app: 'calbou', version: BACKUP_VERSION, exportedAt: now.toISOString(), data };
}

export function parseBackup(text: string): BackupFile {
  const j = JSON.parse(text);
  if (!j || j.app !== 'calbou' || typeof j.version !== 'number' || typeof j.data !== 'object') {
    throw new Error('バックアップファイルの形式が正しくありません');
  }
  if (j.version > BACKUP_VERSION) throw new Error('新しいバージョンのバックアップです。アプリを更新してください');
  return j as BackupFile;
}

export async function restoreBackup(db: AppDb, b: BackupFile): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      const rows = b.data[t] ?? [];
      if (rows.length) await db.table(t).bulkAdd(rows);
    }
  });
}

export async function clearAll(db: AppDb): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear();
  });
}

/** 共有シート(Web Share API)が使えればそれで、無ければダウンロード */
export async function exportFile(file: BackupFile): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const name = `calbou-backup-${file.exportedAt.slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const f = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f], title: name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
