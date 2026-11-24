import type { BodyComposition, Category, Goal, JobActivity, MealEntry, MealItem, Mode, Profile } from '../types';
import { addDays, diffDays, weekStart } from './dates';

// ---- 定数 ----
export const MODE_MULTIPLIER: Record<Mode, number> = { recomp: 1.0, lean_bulk: 1.08, cut: 0.85 };
export const FAT_RATIO = 0.25;
export const DEFAULT_PROTEIN_COEF = 2.2;
export const PROTEIN_COEF_MIN = 1.6;
export const PROTEIN_COEF_MAX = 2.4;
export const FIBER_PER_1000KCAL = 14;
export const SALT_LIMIT = { male: 7.5, female: 6.5 } as const;
export const FEASIBILITY_LIMIT_PCT_PER_WEEK = 0.5;
export const BACKUP_REMIND_DAYS = 14;
export const MIN_DAYS_FOR_WEEK_AVG = 3;

export const CATEGORY_LABEL: Record<Category, string> = {
  breakfast: '朝', lunch: '昼', dinner: '夜', snack: '間食',
};
export const CATEGORIES: Category[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MODE_LABEL: Record<Mode, string> = {
  recomp: 'リコンプ', lean_bulk: 'リーンバルク', cut: '減量',
};

// ---- BMR / TDEE ----
/** 体脂肪率があればカッチ・マカードル式、なければミフリン式 */
export function calcBmr(
  p: Pick<Profile, 'sex' | 'age' | 'heightCm'>,
  weightKg: number,
  bodyFatPercent: number | null,
): number {
  if (bodyFatPercent != null) {
    const lbm = weightKg * (1 - bodyFatPercent / 100);
    return 370 + 21.6 * lbm;
  }
  const base = 10 * weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === 'male' ? base + 5 : base - 161;
}

export function calcTdee(bmr: number, activityFactor: number): number {
  return bmr * activityFactor;
}

/** 仕事の活動量とトレーニング頻度から活動量係数の初期値を提案する */
export function suggestActivityFactor(job: JobActivity, trainingPerWeek: number): number {
  const base = trainingPerWeek >= 6 ? 1.725 : trainingPerWeek >= 3 ? 1.55 : trainingPerWeek >= 1 ? 1.375 : 1.2;
  const jobAdd = job === 'active' ? 0.1 : job === 'standing' ? 0.05 : 0;
  return Math.round((base + jobAdd) * 1000) / 1000;
}

/** 目標カロリー = モード別の値 + 補正値 */
export function calcTargetCalories(tdee: number, mode: Mode, adjustmentKcal: number): number {
  return Math.round(tdee * MODE_MULTIPLIER[mode]) + adjustmentKcal;
}

export interface Targets {
  bmr: number;
  tdee: number;
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  saltG: number;
}

export function calcPfc(calories: number, weightKg: number, proteinCoef: number) {
  const proteinG = Math.round(weightKg * proteinCoef);
  const fatG = Math.round((calories * FAT_RATIO) / 9);
  const carbsG = Math.max(0, Math.round((calories - proteinG * 4 - (calories * FAT_RATIO)) / 4));
  return { proteinG, fatG, carbsG };
}

export function calcTargets(
  profile: Profile,
  goal: Goal,
  weightKg: number,
  bodyFatPercent: number | null,
  proteinCoef: number,
): Targets {
  const bmr = calcBmr(profile, weightKg, bodyFatPercent);
  const tdee = calcTdee(bmr, profile.activityFactor);
  const calories = calcTargetCalories(tdee, goal.mode, goal.calorieAdjustmentKcal);
  const pfc = calcPfc(calories, weightKg, proteinCoef);
  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calories,
    ...pfc,
    fiberG: Math.round((calories / 1000) * FIBER_PER_1000KCAL),
    saltG: SALT_LIMIT[profile.sex],
  };
}

// ---- 実現可能性 ----
export interface Feasibility {
  weeks: number;
  ratePctPerWeek: number; // 現在体重に対する %/週(増加が正)
  warn: boolean;
}
export function checkFeasibility(currentKg: number, goal: Pick<Goal, 'targetWeightKg' | 'startDate' | 'targetDate'>): Feasibility | null {
  const days = diffDays(goal.startDate, goal.targetDate);
  if (days <= 0 || currentKg <= 0) return null;
  const weeks = days / 7;
  const rate = ((goal.targetWeightKg - currentKg) / currentKg / weeks) * 100;
  return { weeks, ratePctPerWeek: rate, warn: Math.abs(rate) > FEASIBILITY_LIMIT_PCT_PER_WEEK };
}

// ---- 栄養素の合計・再計算 ----
export interface Totals {
  caloriesKcal: number; proteinG: number; fatG: number; carbsG: number; fiberG: number; saltG: number;
}
export const emptyTotals = (): Totals => ({ caloriesKcal: 0, proteinG: 0, fatG: 0, carbsG: 0, fiberG: 0, saltG: 0 });

export function sumItems(items: MealItem[]): Totals {
  const t = emptyTotals();
  for (const i of items) {
    t.caloriesKcal += i.caloriesKcal;
    t.proteinG += i.proteinG;
    t.fatG += i.fatG;
    t.carbsG += i.carbsG;
    t.fiberG += i.fiberG ?? 0;
    t.saltG += i.saltG ?? 0;
  }
  return t;
}
export function sumEntries(entries: MealEntry[]): Totals {
  return sumItems(entries.flatMap((e) => e.items));
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 量と全栄養素に factor を掛ける */
export function scaleItem(item: MealItem, factor: number): MealItem {
  const s = (n: number | null) => (n == null ? null : r1(n * factor));
  return {
    ...item,
    amount: r1(item.amount * factor),
    caloriesKcal: Math.round(item.caloriesKcal * factor),
    proteinG: r1(item.proteinG * factor),
    fatG: r1(item.fatG * factor),
    carbsG: r1(item.carbsG * factor),
    fiberG: s(item.fiberG),
    saltG: s(item.saltG),
  };
}

/** 量の変更に伴う再計算。元の量が0なら再計算せず null(手入力を促す) */
export function rescaleToAmount(item: MealItem, newAmount: number): MealItem | null {
  if (!(item.amount > 0) || !(newAmount >= 0)) return null;
  const scaled = scaleItem(item, newAmount / item.amount);
  return { ...scaled, amount: newAmount };
}

// ---- 体重・体組成の時系列 ----
export function latestBody(records: BodyComposition[]): BodyComposition | undefined {
  return [...records].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
}
export function latestBodyFat(records: BodyComposition[]): number | null {
  const r = [...records].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)).find((x) => x.bodyFatPercent != null);
  return r ? r.bodyFatPercent : null;
}

/** 日次の体重(同日は最新値) */
export function dailyWeights(records: BodyComposition[]): { date: string; weightKg: number }[] {
  const map = new Map<string, BodyComposition>();
  for (const r of records) {
    const d = r.measuredAt.slice(0, 10);
    const cur = map.get(d);
    if (!cur || r.measuredAt > cur.measuredAt) map.set(d, r);
  }
  return [...map.entries()]
    .map(([date, r]) => ({ date, weightKg: r.weightKg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 7日移動平均(その日を含む過去7暦日内に記録がある日の平均) */
export function movingAverage7(daily: { date: string; weightKg: number }[]): { date: string; weightKg: number; ma7: number }[] {
  return daily.map((d) => {
    const from = addDays(d.date, -6);
    const w = daily.filter((x) => x.date >= from && x.date <= d.date);
    const ma = w.reduce((s, x) => s + x.weightKg, 0) / w.length;
    return { ...d, ma7: r1(ma) };
  });
}

// ---- 週ごとの摂取カロリー ----
export interface WeekAvg {
  weekStart: string;
  avgKcal: number;
  days: number;
  reference: boolean; // 記録日が3日未満
}
/** 食事が1件以上記録された日だけで平均する(未記録日は0として扱わない) */
export function weeklyCalorieAverages(entries: MealEntry[]): WeekAvg[] {
  const perDay = new Map<string, number>();
  for (const e of entries) {
    if (e.items.length === 0) continue;
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + sumItems(e.items).caloriesKcal);
  }
  const perWeek = new Map<string, number[]>();
  for (const [date, kcal] of perDay) {
    const w = weekStart(date);
    perWeek.set(w, [...(perWeek.get(w) ?? []), kcal]);
  }
  return [...perWeek.entries()]
    .map(([ws, arr]) => ({
      weekStart: ws,
      avgKcal: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
      days: arr.length,
      reference: arr.length < MIN_DAYS_FOR_WEEK_AVG,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

// ---- バックアップ ----
export function backupDue(lastBackupAt: string | null, now: Date = new Date()): boolean {
  if (!lastBackupAt) return true;
  return now.getTime() - new Date(lastBackupAt).getTime() > BACKUP_REMIND_DAYS * 86400000;
}
