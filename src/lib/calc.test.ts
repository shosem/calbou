import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  backupDue, calcBmr, calcPfc, calcTargetCalories, calcTargets, checkFeasibility, dailyWeights,
  movingAverage7, rescaleToAmount, scaleItem, suggestActivityFactor, sumItems, weeklyCalorieAverages,
} from './calc';
import type { BodyComposition, Goal, MealEntry, MealItem, Profile } from '../types';
import { AppDb } from '../db';
import { buildBackup, clearAll, parseBackup, restoreBackup } from './backup';

const profile: Profile = { sex: 'male', age: 30, heightCm: 175, activityFactor: 1.55 };
const goal: Goal = { targetWeightKg: 75, targetBodyFatPercent: 12, startDate: '2026-01-01', targetDate: '2026-07-01', mode: 'recomp', calorieAdjustmentKcal: 0 };

const item = (o: Partial<MealItem> = {}): MealItem => ({
  name: '鶏むね', amount: 100, unit: 'g', caloriesKcal: 120, proteinG: 23, fatG: 2, carbsG: 0,
  fiberG: null, saltG: 0.1, source: 'manual', ...o,
});
const meal = (date: string, kcal: number, id = date): MealEntry => ({
  id, date, category: 'lunch', items: [item({ caloriesKcal: kcal })], createdAt: '',
});
const body = (measuredAt: string, weightKg: number, bf: number | null = null): BodyComposition => ({
  id: measuredAt, measuredAt, source: 'quick', weightKg, bodyFatPercent: bf, bodyFatKg: null, muscleKg: null,
  skeletalMuscleKg: null, leanBodyMassKg: null, visceralFatLevel: null, bodyWaterL: null, bmi: null, bmrKcal: null,
});

describe('BMR / TDEE / 目標', () => {
  it('ミフリン式(男性)', () => expect(calcBmr(profile, 70, null)).toBeCloseTo(1648.75, 2));
  it('ミフリン式(女性)', () => expect(calcBmr({ ...profile, sex: 'female' }, 60, null)).toBeCloseTo(600 + 1093.75 - 150 - 161, 2));
  it('体脂肪率があればカッチ・マカードル式に切り替わる', () => {
    expect(calcBmr(profile, 70, 15)).toBeCloseTo(370 + 21.6 * 59.5, 5);
    expect(calcBmr(profile, 70, 15)).not.toBeCloseTo(calcBmr(profile, 70, null), 0);
  });
  it('初期設定だけで目標カロリーとPFCが式どおり(リコンプ)', () => {
    const t = calcTargets(profile, goal, 70, null, 2.2);
    expect(t.bmr).toBe(1649);
    expect(t.tdee).toBe(2556);
    expect(t.calories).toBe(2556);
    expect(t.proteinG).toBe(154);
    expect(t.fatG).toBe(71); // 2556*0.25/9
    expect(t.carbsG).toBe(325); // (2556-616-639)/4
    expect(t.fiberG).toBe(36);
    expect(t.saltG).toBe(7.5);
  });
  it('モード別と補正値', () => {
    expect(calcTargetCalories(2556, 'lean_bulk', 0)).toBe(Math.round(2556 * 1.08));
    expect(calcTargetCalories(2556, 'cut', 0)).toBe(Math.round(2556 * 0.85));
    expect(calcTargetCalories(2556, 'recomp', 100)).toBe(2656);
  });
  it('PFCの合計カロリーが目標とほぼ一致', () => {
    const { proteinG, fatG, carbsG } = calcPfc(2556, 70, 2.2);
    expect(Math.abs(proteinG * 4 + fatG * 9 + carbsG * 4 - 2556)).toBeLessThan(10);
  });
  it('活動量係数の提案', () => {
    expect(suggestActivityFactor('desk', 4)).toBe(1.55);
    expect(suggestActivityFactor('active', 0)).toBe(1.3);
    expect(suggestActivityFactor('desk', 6)).toBe(1.725);
  });
});

describe('実現可能性', () => {
  it('±0.5%/週を超えると警告', () => {
    const f = checkFeasibility(70, { targetWeightKg: 80, startDate: '2026-01-01', targetDate: '2026-02-01' })!;
    expect(f.warn).toBe(true);
    const g = checkFeasibility(70, { targetWeightKg: 72, startDate: '2026-01-01', targetDate: '2026-07-01' })!;
    expect(g.warn).toBe(false);
  });
  it('期間が不正なら null', () => {
    expect(checkFeasibility(70, { targetWeightKg: 72, startDate: '2026-02-01', targetDate: '2026-01-01' })).toBeNull();
  });
});

describe('栄養素の合計と再計算', () => {
  it('単純合計(null は 0)', () => {
    const t = sumItems([item(), item({ fiberG: 2 })]);
    expect(t.caloriesKcal).toBe(240);
    expect(t.fiberG).toBe(2);
    expect(t.saltG).toBeCloseTo(0.2);
  });
  it('量の変更は比率で再計算', () => {
    const r = rescaleToAmount(item(), 150)!;
    expect(r.amount).toBe(150);
    expect(r.caloriesKcal).toBe(180);
    expect(r.proteinG).toBe(34.5);
    expect(r.fiberG).toBeNull();
  });
  it('元の量が0なら再計算しない', () => expect(rescaleToAmount(item({ amount: 0 }), 10)).toBeNull());
  it('scale', () => expect(scaleItem(item(), 0.5).caloriesKcal).toBe(60));
});

describe('体重・週平均', () => {
  it('同日は最新値、移動平均', () => {
    const d = dailyWeights([body('2026-03-01T07:00', 70), body('2026-03-01T21:00', 71), body('2026-03-02T07:00', 72)]);
    expect(d).toEqual([{ date: '2026-03-01', weightKg: 71 }, { date: '2026-03-02', weightKg: 72 }]);
    expect(movingAverage7(d)[1].ma7).toBe(71.5);
  });
  it('週平均は未記録日を除く', () => {
    // 2026-03-02(月)〜: 3/2 と 3/4 だけ記録
    const w = weeklyCalorieAverages([meal('2026-03-02', 2000, 'a'), meal('2026-03-02', 500, 'b'), meal('2026-03-04', 3000, 'c')]);
    expect(w).toHaveLength(1);
    expect(w[0].days).toBe(2);
    expect(w[0].avgKcal).toBe(2750); // (2500+3000)/2。7日割りの 786 ではない
    expect(w[0].reference).toBe(true);
  });
  it('3日以上は参考値でない', () => {
    const w = weeklyCalorieAverages([meal('2026-03-02', 2000), meal('2026-03-03', 2000), meal('2026-03-04', 2000)]);
    expect(w[0].reference).toBe(false);
  });
});

describe('バックアップ', () => {
  it('14日リマインド', () => {
    expect(backupDue(null)).toBe(true);
    expect(backupDue(new Date(Date.now() - 13 * 86400000).toISOString())).toBe(false);
    expect(backupDue(new Date(Date.now() - 15 * 86400000).toISOString())).toBe(true);
  });
  it('書き出し → 全消去 → 読み込みで元通り、APIキーを含まない', async () => {
    const db = new AppDb('test-backup');
    await db.meals.add(meal('2026-03-02', 500));
    await db.body.add(body('2026-03-02T07:00', 70));
    const file = await buildBackup(db);
    const text = JSON.stringify(file);
    expect(text.toLowerCase()).not.toContain('apikey');
    await clearAll(db);
    expect(await db.meals.count()).toBe(0);
    await restoreBackup(db, parseBackup(text));
    expect(await db.meals.count()).toBe(1);
    expect((await db.body.toArray())[0].weightKg).toBe(70);
  });
  it('不正な形式は拒否', () => expect(() => parseBackup('{"a":1}')).toThrow());
});
