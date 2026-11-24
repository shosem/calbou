import type { AppDb } from '../db';
import type { AiUsage } from '../types';

/** 1日のAI呼び出し上限(利用者がAI Studioで確認した無料枠RPD=20)。超えるとAPIを呼ばない */
export const DAILY_AI_LIMIT = 20;

export type GuardResult = { ok: true } | { ok: false; reason: 'limit' | 'stopped' };

export function checkUsage(u: AiUsage | undefined, limit = DAILY_AI_LIMIT): GuardResult {
  if (u?.stopped) return { ok: false, reason: 'stopped' };
  if ((u?.count ?? 0) >= limit) return { ok: false, reason: 'limit' };
  return { ok: true };
}

/** 呼び出し前に1回分を確保(カウント)する。上限・停止中なら何も増やさず拒否する */
export async function reserveCall(db: AppDb, date: string, limit = DAILY_AI_LIMIT): Promise<GuardResult> {
  return db.transaction('rw', db.aiUsage, async () => {
    const u = await db.aiUsage.get(date);
    const g = checkUsage(u, limit);
    if (!g.ok) return g;
    await db.aiUsage.put({ date, count: (u?.count ?? 0) + 1, stopped: false });
    return g;
  });
}

/** 429を受けた日は停止扱い(日付が変われば別レコードなので自動解除される) */
export async function markStopped(db: AppDb, date: string): Promise<void> {
  const u = await db.aiUsage.get(date);
  await db.aiUsage.put({ date, count: u?.count ?? 0, stopped: true });
}

export async function clearStopped(db: AppDb, date: string): Promise<void> {
  const u = await db.aiUsage.get(date);
  if (u) await db.aiUsage.put({ ...u, stopped: false });
}
