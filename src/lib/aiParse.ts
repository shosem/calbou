import type { MealItem, Source } from '../types';
import { AiError } from './gemini';
import { scaleItem } from './calc';

// ---- JSON Schema(Gemini構造化出力) ----
const itemProps = {
  name: { type: 'string' },
  amount: { type: 'number' },
  unit: { type: 'string' },
  calories_kcal: { type: 'number' },
  protein_g: { type: 'number' },
  fat_g: { type: 'number' },
  carbs_g: { type: 'number' },
  fiber_g: { type: ['number', 'null'] },
  salt_g: { type: ['number', 'null'] },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
};
const itemSchema = {
  type: 'object', properties: itemProps,
  required: ['name', 'amount', 'unit', 'calories_kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'salt_g', 'confidence'],
};
export const ITEMS_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: itemSchema }, notes: { type: 'string' } },
  required: ['items', 'notes'],
};
export const OPERATIONS_SCHEMA = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['scale', 'remove', 'replace', 'add'] },
          item_index: { type: ['integer', 'null'] },
          factor: { type: ['number', 'null'] },
          item: { anyOf: [itemSchema, { type: 'null' }] },
        },
        required: ['op', 'item_index', 'factor', 'item'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['operations', 'notes'],
};

// ---- 検証・変換 ----
const bad = (m: string) => new AiError('bad_response', m);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const nonNeg = (v: unknown): number => Math.max(0, num(v) ?? 0);

export function toMealItem(raw: any, source: Source): MealItem {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) throw bad('食品データの形式が正しくありません。');
  const conf = ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low';
  return {
    name: raw.name.trim(),
    amount: nonNeg(raw.amount),
    unit: typeof raw.unit === 'string' && raw.unit ? raw.unit : 'g',
    caloriesKcal: Math.round(nonNeg(raw.calories_kcal)),
    proteinG: nonNeg(raw.protein_g),
    fatG: nonNeg(raw.fat_g),
    carbsG: nonNeg(raw.carbs_g),
    fiberG: num(raw.fiber_g) == null ? null : Math.max(0, raw.fiber_g),
    saltG: num(raw.salt_g) == null ? null : Math.max(0, raw.salt_g),
    source,
    confidence: conf,
  };
}

export function parseItemsResponse(json: unknown, source: Source): { items: MealItem[]; notes: string } {
  const j = json as any;
  if (!j || !Array.isArray(j.items)) throw bad('AIの応答に食品リストがありませんでした。');
  return { items: j.items.map((r: unknown) => toMealItem(r, source)), notes: typeof j.notes === 'string' ? j.notes : '' };
}

export type Operation =
  | { op: 'scale'; itemIndex: number; factor: number }
  | { op: 'remove'; itemIndex: number }
  | { op: 'replace'; itemIndex: number; item: MealItem }
  | { op: 'add'; item: MealItem };

export const MAX_SCALE = 10;

/** 不正な操作(範囲外の添字、factor<=0 など)は捨てて、理由を warnings に残す */
export function parseOperationsResponse(json: unknown, itemCount: number, source: Source): { operations: Operation[]; notes: string; warnings: string[] } {
  const j = json as any;
  if (!j || !Array.isArray(j.operations)) throw bad('AIの応答に操作リストがありませんでした。');
  const ops: Operation[] = []; const warnings: string[] = [];
  const idxOk = (i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < itemCount;
  for (const o of j.operations) {
    try {
      if (o?.op === 'scale') {
        if (!idxOk(o.item_index) || !(num(o.factor) != null && o.factor > 0 && o.factor <= MAX_SCALE)) throw bad('scale');
        ops.push({ op: 'scale', itemIndex: o.item_index, factor: o.factor });
      } else if (o?.op === 'remove') {
        if (!idxOk(o.item_index)) throw bad('remove');
        ops.push({ op: 'remove', itemIndex: o.item_index });
      } else if (o?.op === 'replace') {
        if (!idxOk(o.item_index)) throw bad('replace');
        ops.push({ op: 'replace', itemIndex: o.item_index, item: toMealItem(o.item, source) });
      } else if (o?.op === 'add') {
        ops.push({ op: 'add', item: toMealItem(o.item, source) });
      } else throw bad('unknown');
    } catch { warnings.push('解釈できない操作を1件無視しました。'); }
  }
  return { operations: ops, notes: typeof j.notes === 'string' ? j.notes : '', warnings };
}

export interface DiffEntry { kind: 'scale' | 'remove' | 'replace' | 'add'; before?: MealItem; after?: MealItem }

/** 操作を適用する。scale の計算はここ(プログラム)で行い、AIは計算しない。添字は元のリストを指す */
export function applyOperations(items: MealItem[], ops: Operation[]): { items: MealItem[]; diff: DiffEntry[] } {
  const state: (MealItem | null)[] = items.map((x) => x);
  const added: MealItem[] = [];
  const diff: DiffEntry[] = [];
  for (const o of ops) {
    if (o.op === 'add') { added.push(o.item); diff.push({ kind: 'add', after: o.item }); continue; }
    const cur = state[o.itemIndex];
    if (!cur) continue; // 既に削除済み
    if (o.op === 'remove') { state[o.itemIndex] = null; diff.push({ kind: 'remove', before: cur }); }
    else if (o.op === 'scale') { const a = scaleItem(cur, o.factor); state[o.itemIndex] = a; diff.push({ kind: 'scale', before: cur, after: a }); }
    else { state[o.itemIndex] = o.item; diff.push({ kind: 'replace', before: cur, after: o.item }); }
  }
  return { items: [...state.filter((x): x is MealItem => x !== null), ...added], diff };
}
