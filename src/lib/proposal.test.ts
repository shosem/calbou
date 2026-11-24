import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDb } from '../db';
import type { BodyComposition, MealEntry, Mode } from '../types';
import { addDays } from './dates';
import { approveProposal, evaluateAdjustment, rejectProposal, reviewDue, saveEvaluation } from './proposal';
import { calcTargets } from './calc';

const today = '2026-11-24';
const bodyRec = (date: string, w: number, bf: number | null = null, muscle: number | null = null): BodyComposition => ({
  id: date + w + bf, measuredAt: `${date}T07:00`, source: 'manual', weightKg: w, bodyFatPercent: bf, bodyFatKg: null, muscleKg: muscle,
  skeletalMuscleKg: null, leanBodyMassKg: null, visceralFatLevel: null, bodyWaterL: null, bmi: null, bmrKcal: null,
});
/** 週ごとの平均体重を指定して、各週7日分の体重を作る。[前々週, 前週, 直近週] */
function weights(w: [number | null, number, number]): BodyComposition[] {
  const out: BodyComposition[] = [];
  const starts = [-20, -13, -6];
  w.forEach((v, wi) => { if (v != null) for (let i = 0; i < 7; i++) out.push(bodyRec(addDays(today, starts[wi] + i), v)); });
  return out;
}
const mealsFor = (days: number): MealEntry[] => Array.from({ length: days }, (_, i) => ({
  id: String(i), date: addDays(today, -i), category: 'lunch' as const, createdAt: '',
  items: [{ name: 'x', amount: 1, unit: '個', caloriesKcal: 500, proteinG: 0, fatG: 0, carbsG: 0, fiberG: null, saltG: null, source: 'manual' as const }],
}));
const ev = (mode: Mode, body: BodyComposition[], meals = mealsFor(14)) => evaluateAdjustment({ mode, today, body, meals });

describe('判定の最低条件', () => {
  it('体重・食事の記録日が7日未満なら提案を出さず、足りない内容を示す', () => {
    const r = ev('recomp', weights([null, 70, 70.3]).slice(0, 4), mealsFor(3));
    expect(r.status).toBe('insufficient');
    if (r.status === 'insufficient') expect(r.missing.length).toBe(2);
  });
  it('どちらかの週に体重が無ければ不足', () => expect(ev('cut', weights([null, 70, 70]).filter((b) => b.measuredAt < `${addDays(today, -6)}`)).status).toBe('insufficient'));
});

describe('リコンプ / リーンバルク', () => {
  it('ルール1: 増加が速く体脂肪率が上昇 → -100', () => {
    const b = [...weights([null, 70, 70.3]), bodyRec(addDays(today, -10), 70, 15.0), bodyRec(addDays(today, -1), 70.3, 15.6)];
    const r = ev('lean_bulk', b);
    expect(r).toMatchObject({ status: 'proposal', deltaKcal: -100 });
  });
  it('ルール1: 体脂肪率データが2件未満なら評価せず、理由に明記される', () => {
    const r = ev('recomp', weights([null, 70, 70.3]));
    expect(r.status).toBe('none');
    if (r.status === 'none') expect(r.reason).toContain('体脂肪率の記録が2件未満');
  });
  it('ルール2: 横ばいが2週続く → +100', () => {
    const r = ev('recomp', weights([70, 70.02, 70.05]));
    expect(r).toMatchObject({ status: 'proposal', deltaKcal: 100 });
  });
  it('ルール2: 筋肉量が増えていれば横ばいでも提案しない', () => {
    const b = [...weights([70, 70.02, 70.05]), bodyRec(addDays(today, -12), 70, null, 33.0), bodyRec(addDays(today, -1), 70, null, 33.8)];
    expect(ev('recomp', b).status).toBe('none');
  });
  it('ルール2: 前々週のデータが無いと「2週続く」を評価できない(理由つきで提案なし)', () => {
    const r = ev('recomp', weights([null, 70, 70.05]));
    expect(r.status).toBe('none');
    if (r.status === 'none') expect(r.reason).toContain('前々週');
  });
  it('ルール3: 0〜+0.25%/週で順調 → 提案なし', () => {
    const r = ev('lean_bulk', weights([69.9, 70, 70.14]));
    expect(r).toMatchObject({ status: 'none', onTrack: true });
  });
  it('ルール4: どれにも当てはまらない(減少) → 理由つきで提案なし', () => {
    const r = ev('recomp', weights([70.5, 70.4, 70.0]));
    expect(r).toMatchObject({ status: 'none', onTrack: false });
    if (r.status === 'none') expect(r.reason).toContain('判定条件に該当しませんでした');
  });
});

describe('減量', () => {
  it('ルール1: 減りすぎ(-1.0%/週より速い) → +100', () => expect(ev('cut', weights([null, 70, 69.2]))).toMatchObject({ status: 'proposal', deltaKcal: 100 }));
  it('ルール2: 停滞が2週続く → -100', () => expect(ev('cut', weights([70, 69.95, 69.9]))).toMatchObject({ status: 'proposal', deltaKcal: -100 }));
  it('ルール2: 停滞でも1週だけなら提案しない', () => {
    const r = ev('cut', weights([70.5, 70, 69.95]));
    expect(r.status).toBe('none');
  });
  it('ルール3: -0.25〜-1.0%/週 → 順調', () => expect(ev('cut', weights([null, 70, 69.7]))).toMatchObject({ status: 'none', onTrack: true }));
  it('ルール4: 増加している → 理由つきで提案なし', () => {
    const r = ev('cut', weights([null, 70, 70.4]));
    expect(r.status).toBe('none');
  });
});

describe('承認フロー', () => {
  const profile = { sex: 'male' as const, age: 30, heightCm: 175, activityFactor: 1.55 };
  const settings = (adj = 0) => ({
    id: 'main' as const, profile, jobActivity: 'desk' as const, trainingPerWeek: 3, proteinCoef: 2.2, onboarded: true, lastBackupAt: null,
    goal: { targetWeightKg: 75, targetBodyFatPercent: 12, startDate: '2026-01-01', targetDate: '2026-12-31', mode: 'recomp' as const, calorieAdjustmentKcal: adj },
  });
  it('承認するまで目標カロリーは変わらず、承認時のみ±100反映。二重承認は無効', async () => {
    const db = new AppDb('prop-1');
    await db.settings.put(settings());
    const before = calcTargets(profile, settings().goal, 70, null, 2.2).calories;
    await saveEvaluation(db, { status: 'proposal', deltaKcal: 100, reason: 'r' }, 'p1');
    expect((await db.settings.get('main'))!.goal.calorieAdjustmentKcal).toBe(0); // 提案しただけでは変わらない
    expect(await approveProposal(db, 'p1')).toBe(true);
    const s = (await db.settings.get('main'))!;
    expect(s.goal.calorieAdjustmentKcal).toBe(100);
    expect(calcTargets(profile, s.goal, 70, null, 2.2).calories).toBe(before + 100);
    expect(await approveProposal(db, 'p1')).toBe(false);
    expect((await db.settings.get('main'))!.goal.calorieAdjustmentKcal).toBe(100);
  });
  it('却下しても変わらず、履歴に残る', async () => {
    const db = new AppDb('prop-2');
    await db.settings.put(settings(-100));
    await saveEvaluation(db, { status: 'proposal', deltaKcal: 100, reason: 'r' }, 'p2');
    expect(await rejectProposal(db, 'p2')).toBe(true);
    expect((await db.settings.get('main'))!.goal.calorieAdjustmentKcal).toBe(-100);
    expect((await db.proposals.get('p2'))!.status).toBe('rejected');
    expect(await approveProposal(db, 'p2')).toBe(false);
  });
  it('判定不能は履歴に残さず、提案なしは delta=0 で残る。2週間ごとに判定', async () => {
    const db = new AppDb('prop-3');
    expect(await saveEvaluation(db, { status: 'insufficient', missing: ['x'] }, 'a')).toBeNull();
    const rec = await saveEvaluation(db, { status: 'none', onTrack: true, reason: 'ok' }, 'b', new Date('2026-11-01T00:00:00Z'));
    expect(rec!.deltaKcal).toBe(0);
    expect(reviewDue([rec!], new Date('2026-11-10T00:00:00Z'))).toBe(false);
    expect(reviewDue([rec!], new Date('2026-11-16T00:00:00Z'))).toBe(true);
    expect(reviewDue([])).toBe(true);
  });
});
