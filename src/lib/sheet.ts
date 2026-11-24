import type { BodyComposition, SheetLabelMapping } from '../types';
import { AiError } from './gemini';

export type NumField = 'weightKg' | 'bodyFatPercent' | 'bodyFatKg' | 'muscleKg' | 'skeletalMuscleKg' | 'leanBodyMassKg' | 'visceralFatLevel' | 'bodyWaterL' | 'bmi' | 'bmrKcal';
export const NUM_FIELDS: NumField[] = ['weightKg', 'bodyFatPercent', 'bodyFatKg', 'muscleKg', 'skeletalMuscleKg', 'leanBodyMassKg', 'visceralFatLevel', 'bodyWaterL', 'bmi', 'bmrKcal'];
export const FIELD_LABEL: Record<NumField, string> = {
  weightKg: '体重(kg)', bodyFatPercent: '体脂肪率(%)', bodyFatKg: '体脂肪量(kg)', muscleKg: '筋肉量(kg)', skeletalMuscleKg: '骨格筋量(kg)',
  leanBodyMassKg: '除脂肪体重(kg)', visceralFatLevel: '内臓脂肪レベル', bodyWaterL: '体水分量(L)', bmi: 'BMI', bmrKcal: '基礎代謝(kcal)',
};

const nullableNum = { type: ['number', 'null'] };
export const SHEET_SCHEMA = {
  type: 'object',
  properties: {
    measured_at: { type: ['string', 'null'] },
    weight_kg: nullableNum, body_fat_percent: nullableNum, body_fat_kg: nullableNum, muscle_kg: nullableNum,
    skeletal_muscle_kg: nullableNum, lean_body_mass_kg: nullableNum, visceral_fat_level: nullableNum,
    body_water_l: nullableNum, bmi: nullableNum, bmr_kcal: nullableNum,
    raw_items: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] } },
  },
  required: ['measured_at', 'weight_kg', 'body_fat_percent', 'body_fat_kg', 'muscle_kg', 'skeletal_muscle_kg', 'lean_body_mass_kg', 'visceral_fat_level', 'body_water_l', 'bmi', 'bmr_kcal', 'raw_items'],
};

export const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    product_name: { type: ['string', 'null'] }, serving_amount: nullableNum, serving_unit: { type: ['string', 'null'] },
    calories_kcal: nullableNum, protein_g: nullableNum, fat_g: nullableNum, carbs_g: nullableNum, fiber_g: nullableNum, salt_g: nullableNum,
  },
  required: ['product_name', 'serving_amount', 'serving_unit', 'calories_kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'salt_g'],
};

const bad = (m: string) => new AiError('bad_response', m);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** "58.4kg" "１５．２ %" のような文字列から最初の数値を取り出す(単位変換はしない) */
export function parseNumber(s: string): number | null {
  const half = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/．/g, '.').replace(/,/g, '');
  const m = half.match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export interface SheetParse {
  measuredAt: string | null;
  values: Partial<Record<NumField, number>>; // 読み取れた項目のみ(null は含めない)
  rawItems: { label: string; value: string }[];
}

export function parseSheetResponse(json: unknown): SheetParse {
  const j = json as any;
  if (!j || typeof j !== 'object' || !Array.isArray(j.raw_items)) throw bad('AIの応答の形式が正しくありません。');
  const src: Record<NumField, string> = {
    weightKg: 'weight_kg', bodyFatPercent: 'body_fat_percent', bodyFatKg: 'body_fat_kg', muscleKg: 'muscle_kg', skeletalMuscleKg: 'skeletal_muscle_kg',
    leanBodyMassKg: 'lean_body_mass_kg', visceralFatLevel: 'visceral_fat_level', bodyWaterL: 'body_water_l', bmi: 'bmi', bmrKcal: 'bmr_kcal',
  };
  const values: SheetParse['values'] = {};
  for (const f of NUM_FIELDS) { const v = num(j[src[f]]); if (v != null) values[f] = v; }
  const rawItems = j.raw_items
    .filter((r: any) => r && typeof r.label === 'string' && typeof r.value === 'string' && r.label.trim())
    .map((r: any) => ({ label: r.label.trim(), value: r.value.trim() }));
  const at = typeof j.measured_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(j.measured_at) ? j.measured_at.slice(0, 16) : null;
  return { measuredAt: at, values, rawItems };
}

/**
 * 保存済みの対応付け(シート上の項目名 → 記録項目)を初期値として適用する。
 * 戻り値の assignments は rawItems と同じ並びで、対応付けが無い項目は null。
 */
export function resolveSheet(p: SheetParse, mappings: SheetLabelMapping[]) {
  const map = new Map(mappings.map((m) => [m.label, m.field as NumField]));
  const values = { ...p.values };
  const assignments: (NumField | null)[] = p.rawItems.map((r) => {
    const f = map.get(r.label);
    if (!f || !NUM_FIELDS.includes(f)) return null;
    const n = parseNumber(r.value);
    if (n == null) return null;
    values[f] = n;
    return f;
  });
  return { values, assignments };
}

/** 保存する対応付けと、削除する対応付け(「対応なし」に変更された保存済みラベル)を決める */
export function diffMappings(rawItems: { label: string }[], assignments: (NumField | null)[], existing: SheetLabelMapping[]) {
  const toSave: SheetLabelMapping[] = []; const toDelete: string[] = [];
  const have = new Set(existing.map((m) => m.label));
  rawItems.forEach((r, i) => {
    const f = assignments[i];
    if (f) toSave.push({ label: r.label, field: f });
    else if (have.has(r.label)) toDelete.push(r.label);
  });
  return { toSave, toDelete };
}

export function sheetToRecord(p: SheetParse, values: Partial<Record<NumField, number>>, now: string): Omit<BodyComposition, 'id'> {
  const g = (f: NumField) => values[f] ?? null;
  return {
    measuredAt: p.measuredAt ?? now, source: 'ai_sheet', weightKg: values.weightKg ?? 0,
    bodyFatPercent: g('bodyFatPercent'), bodyFatKg: g('bodyFatKg'), muscleKg: g('muscleKg'), skeletalMuscleKg: g('skeletalMuscleKg'),
    leanBodyMassKg: g('leanBodyMassKg'), visceralFatLevel: g('visceralFatLevel'), bodyWaterL: g('bodyWaterL'), bmi: g('bmi'), bmrKcal: g('bmrKcal'),
  };
}

// ---- 栄養成分表示 ----
export interface LabelParse {
  name: string; servingAmount: number; servingUnit: string;
  caloriesKcal: number; proteinG: number; fatG: number; carbsG: number; fiberG: number | null; saltG: number | null;
  unread: string[]; // 読み取れなかった項目名(確認画面で表示)
}
export function parseLabelResponse(json: unknown): LabelParse {
  const j = json as any;
  if (!j || typeof j !== 'object') throw bad('AIの応答の形式が正しくありません。');
  const unread: string[] = [];
  const req = (v: unknown, name: string) => { const n = num(v); if (n == null) { unread.push(name); return 0; } return n; };
  const out: LabelParse = {
    name: typeof j.product_name === 'string' ? j.product_name.trim() : '',
    servingAmount: req(j.serving_amount, '1回分の量'),
    servingUnit: typeof j.serving_unit === 'string' && j.serving_unit ? j.serving_unit : 'g',
    caloriesKcal: req(j.calories_kcal, 'カロリー'), proteinG: req(j.protein_g, 'たんぱく質'), fatG: req(j.fat_g, '脂質'), carbsG: req(j.carbs_g, '炭水化物'),
    fiberG: num(j.fiber_g), saltG: num(j.salt_g), unread,
  };
  if (!out.name) unread.push('商品名');
  if (out.fiberG == null) unread.push('食物繊維');
  if (out.saltG == null) unread.push('塩分');
  return out;
}
