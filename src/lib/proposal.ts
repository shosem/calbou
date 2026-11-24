import type { AppDb } from '../db';
import type { AdjustmentProposal, BodyComposition, MealEntry, Mode } from '../types';
import { dailyWeights } from './calc';
import { addDays } from './dates';

// ---- 閾値(調整しやすいよう定数にまとめる) ----
export const ADJUST_STEP_KCAL = 100;
export const BULK_GAIN_FAST_PCT = 0.25;        // リコンプ/バルク: これを超える増加は速い
export const FLAT_PCT = 0.1;                   // 横ばい: ±0.1%/週以内
export const CUT_TOO_FAST_PCT = -1.0;          // 減量: これより速い減少は減りすぎ
export const CUT_STALL_PCT = -0.25;            // 減量: これより小さい減少は停滞
export const MIN_WEIGHT_DAYS = 7;              // 直近14日で体重の記録がある日
export const MIN_MEAL_DAYS = 7;                // 直近14日で食事の記録がある日
export const COMPOSITION_LOOKBACK_DAYS = 28;   // 体脂肪率・筋肉量の傾向を見る期間
export const BODY_FAT_FLAT_PT = 0.2;           // 体脂肪率の横ばい幅(±pt)
export const MUSCLE_FLAT_KG = 0.2;             // 筋肉量の横ばい幅(±kg)
export const REVIEW_INTERVAL_DAYS = 14;

export type Trend = 'up' | 'flat' | 'down';

export type Evaluation =
  | { status: 'insufficient'; missing: string[] }
  | { status: 'proposal'; deltaKcal: number; reason: string }
  | { status: 'none'; onTrack: boolean; reason: string };

export interface EvalInput { mode: Mode; today: string; body: BodyComposition[]; meals: MealEntry[] }

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const pct = (n: number) => `${n >= 0 ? '+' : ''}${(Math.round(n * 100) / 100).toFixed(2)}%/週`;

function weekAvg(daily: { date: string; weightKg: number }[], from: string, to: string) {
  return avg(daily.filter((d) => d.date >= from && d.date <= to).map((d) => d.weightKg));
}

/** 値の列(新しい順に2件)から傾向を出す。2件未満なら null(評価不能) */
function trendOf(values: { at: string; v: number }[], flat: number): Trend | null {
  const s = [...values].sort((a, b) => b.at.localeCompare(a.at));
  if (s.length < 2) return null;
  const d = s[0].v - s[1].v;
  return d > flat ? 'up' : d < -flat ? 'down' : 'flat';
}

export function evaluateAdjustment({ mode, today, body, meals }: EvalInput): Evaluation {
  const daily = dailyWeights(body);
  const winFrom = addDays(today, -13);
  const weightDays = daily.filter((d) => d.date >= winFrom && d.date <= today).length;
  const mealDays = new Set(meals.filter((m) => m.items.length > 0 && m.date >= winFrom && m.date <= today).map((m) => m.date)).size;

  const missing: string[] = [];
  if (weightDays < MIN_WEIGHT_DAYS) missing.push(`直近14日の体重の記録日数が不足しています(${weightDays}/${MIN_WEIGHT_DAYS}日)`);
  if (mealDays < MIN_MEAL_DAYS) missing.push(`直近14日の食事の記録日数が不足しています(${mealDays}/${MIN_MEAL_DAYS}日)`);

  // 週平均: 直近週(今日を含む7日)・前週・前々週
  const cur = weekAvg(daily, addDays(today, -6), today);
  const prev = weekAvg(daily, addDays(today, -13), addDays(today, -7));
  const prev2 = weekAvg(daily, addDays(today, -20), addDays(today, -14));
  if (missing.length === 0 && (cur == null || prev == null)) missing.push('直近の週と前の週、それぞれに体重の記録が必要です');
  if (missing.length > 0) return { status: 'insufficient', missing };

  const rCur = ((cur! - prev!) / prev!) * 100;
  const rPrev = prev2 != null ? ((prev! - prev2) / prev2) * 100 : null; // 「2週続く」の判定に使う前週の変化
  const rateText = `体重の週平均の変化は${pct(rCur)}(直近週 ${cur!.toFixed(1)}kg / 前週 ${prev!.toFixed(1)}kg)`;
  const unevaluated: string[] = [];
  const note = () => (unevaluated.length ? ` ※${unevaluated.join(' ')}` : '');
  const since = addDays(today, -COMPOSITION_LOOKBACK_DAYS);

  if (mode === 'cut') {
    if (rCur < CUT_TOO_FAST_PCT) {
      return { status: 'proposal', deltaKcal: ADJUST_STEP_KCAL, reason: `${rateText}で、減りすぎ(${pct(CUT_TOO_FAST_PCT)}より速い)です。筋肉を守るため +${ADJUST_STEP_KCAL}kcal を提案します。` };
    }
    if (rCur > CUT_STALL_PCT) {
      if (rPrev == null) unevaluated.push('「停滞が2週続く」の判定には前々週の体重記録も必要なため、評価できませんでした。');
      else if (rPrev > CUT_STALL_PCT) {
        return { status: 'proposal', deltaKcal: -ADJUST_STEP_KCAL, reason: `${rateText}で、前週(${pct(rPrev)})に続き減少が${pct(CUT_STALL_PCT)}より小さく、停滞が2週続いています。-${ADJUST_STEP_KCAL}kcal を提案します。` };
      }
    }
    if (rCur >= CUT_TOO_FAST_PCT && rCur <= CUT_STALL_PCT) return { status: 'none', onTrack: true, reason: `${rateText}で、順調です。提案はありません。` };
    return { status: 'none', onTrack: false, reason: `${rateText}。判定条件に該当しませんでした。${note()}` };
  }

  // リコンプ / リーンバルク
  const bf = trendOf(body.filter((b) => b.bodyFatPercent != null && b.measuredAt.slice(0, 10) >= since).map((b) => ({ at: b.measuredAt, v: b.bodyFatPercent! })), BODY_FAT_FLAT_PT);
  const mu = trendOf(body.filter((b) => (b.skeletalMuscleKg ?? b.muscleKg) != null && b.measuredAt.slice(0, 10) >= since).map((b) => ({ at: b.measuredAt, v: (b.skeletalMuscleKg ?? b.muscleKg)! })), MUSCLE_FLAT_KG);

  if (rCur > BULK_GAIN_FAST_PCT) {
    if (bf == null) unevaluated.push('体脂肪率の記録が2件未満のため、「増加が速く体脂肪率が上昇」のルールを評価できませんでした。');
    else if (bf === 'up') {
      return { status: 'proposal', deltaKcal: -ADJUST_STEP_KCAL, reason: `${rateText}で増加が速く(${pct(BULK_GAIN_FAST_PCT)}超)、体脂肪率も上昇しています。-${ADJUST_STEP_KCAL}kcal を提案します。` };
    }
  }
  if (rPrev == null) {
    unevaluated.push('「横ばいが2週続く」の判定には前々週の体重記録も必要なため、評価できませんでした。');
  } else if (Math.abs(rCur) <= FLAT_PCT && Math.abs(rPrev) <= FLAT_PCT && mu !== 'up') {
    return { status: 'proposal', deltaKcal: ADJUST_STEP_KCAL, reason: `${rateText}で、前週(${pct(rPrev)})に続き横ばいが2週続いています${mu ? '(筋肉量も横ばい〜低下)' : ''}。+${ADJUST_STEP_KCAL}kcal を提案します。` };
  }
  if (rCur >= 0 && rCur <= BULK_GAIN_FAST_PCT && bf !== 'up') {
    return { status: 'none', onTrack: true, reason: `${rateText}で、増加ペースは順調です。提案はありません。${note()}` };
  }
  return { status: 'none', onTrack: false, reason: `${rateText}。判定条件に該当しませんでした。${note()}` };
}

// ---- 提案の保存・承認・却下 ----
export function reviewDue(history: AdjustmentProposal[], now: Date = new Date()): boolean {
  if (history.length === 0) return true;
  const last = Math.max(...history.map((h) => new Date(h.createdAt).getTime()));
  return now.getTime() - last >= REVIEW_INTERVAL_DAYS * 86400000;
}

export async function saveEvaluation(db: AppDb, ev: Evaluation, id: string, now: Date = new Date()): Promise<AdjustmentProposal | null> {
  if (ev.status === 'insufficient') return null; // 判定できなかった場合は履歴に残さない(再判定できるように)
  const rec: AdjustmentProposal = ev.status === 'proposal'
    ? { id, createdAt: now.toISOString(), deltaKcal: ev.deltaKcal, reason: ev.reason, status: 'pending' }
    : { id, createdAt: now.toISOString(), deltaKcal: 0, reason: ev.reason, status: 'approved' }; // 提案なし(対応不要で完了)
  await db.proposals.put(rec);
  return rec;
}

/** 承認したときだけ目標カロリーの補正値を変更する。pending 以外は何もしない */
export async function approveProposal(db: AppDb, id: string): Promise<boolean> {
  return db.transaction('rw', db.proposals, db.settings, async () => {
    const p = await db.proposals.get(id);
    const s = await db.settings.get('main');
    if (!p || !s || p.status !== 'pending') return false;
    await db.settings.put({ ...s, goal: { ...s.goal, calorieAdjustmentKcal: s.goal.calorieAdjustmentKcal + p.deltaKcal } });
    await db.proposals.update(id, { status: 'approved' });
    return true;
  });
}
export async function rejectProposal(db: AppDb, id: string): Promise<boolean> {
  const p = await db.proposals.get(id);
  if (!p || p.status !== 'pending') return false;
  await db.proposals.update(id, { status: 'rejected' });
  return true;
}
