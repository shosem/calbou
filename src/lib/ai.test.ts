import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDb } from '../db';
import { DAILY_AI_LIMIT, clearStopped, reserveCall } from './aiGuard';
import { AiError, aiStore, callGemini } from './gemini';
import { applyOperations, parseItemsResponse, parseOperationsResponse } from './aiParse';
import type { MealItem } from '../types';

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
};

const req = { system: 's', text: 't', schema: {} };
const okRes = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
const now = new Date(2026, 10, 24, 12, 0);
let db: AppDb; let n = 0;

beforeEach(() => {
  mem.clear(); aiStore.setKey('k'); aiStore.setConsent(true);
  db = new AppDb(`ai-test-${n++}`);
});

describe('課金防止ガード', () => {
  it('上限に達するとAPIを呼ばない', async () => {
    const f = vi.fn(async () => okRes({}));
    for (let i = 0; i < DAILY_AI_LIMIT; i++) await callGemini(db, req, { fetchImpl: f as any, now });
    expect(f).toHaveBeenCalledTimes(DAILY_AI_LIMIT);
    await expect(callGemini(db, req, { fetchImpl: f as any, now })).rejects.toMatchObject({ kind: 'limit' });
    expect(f).toHaveBeenCalledTimes(DAILY_AI_LIMIT); // 増えない
  });
  it('429は1回で停止し、リトライしない。日付が変われば自動解除', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 429 }));
    await expect(callGemini(db, req, { fetchImpl: f as any, now })).rejects.toMatchObject({ kind: 'quota' });
    expect(f).toHaveBeenCalledTimes(1);
    await expect(callGemini(db, req, { fetchImpl: f as any, now })).rejects.toMatchObject({ kind: 'stopped' });
    expect(f).toHaveBeenCalledTimes(1);
    const tomorrow = new Date(2026, 10, 25, 9, 0);
    await expect(callGemini(db, req, { fetchImpl: vi.fn(async () => okRes({ a: 1 })) as any, now: tomorrow })).resolves.toEqual({ a: 1 });
  });
  it('手動で停止状態を解除できる', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 429 }));
    await callGemini(db, req, { fetchImpl: f as any, now }).catch(() => {});
    await clearStopped(db, '2026-11-24');
    expect((await reserveCall(db, '2026-11-24')).ok).toBe(true);
  });
  it('キー・同意が無ければAPIを呼ばない(カウントもしない)', async () => {
    const f = vi.fn();
    aiStore.setKey('');
    await expect(callGemini(db, req, { fetchImpl: f as any, now })).rejects.toMatchObject({ kind: 'disabled' });
    aiStore.setKey('k'); aiStore.setConsent(false);
    await expect(callGemini(db, req, { fetchImpl: f as any, now })).rejects.toBeInstanceOf(AiError);
    expect(f).not.toHaveBeenCalled();
    expect(await db.aiUsage.count()).toBe(0);
  });
  it('ネットワークエラーは手入力を案内する', async () => {
    const f = vi.fn(async () => { throw new TypeError('x'); });
    await expect(callGemini(db, req, { fetchImpl: f as any, now })).rejects.toMatchObject({ kind: 'network' });
  });
  it('キーはヘッダーで渡しURLに含めない', async () => {
    const f = vi.fn(async (_u: string, _i: any) => okRes({}));
    await callGemini(db, req, { fetchImpl: f as any, now });
    const [url, init] = f.mock.calls[0];
    expect(url).not.toContain('key=');
    expect(init.headers['x-goog-api-key']).toBe('k');
  });
});

const base = (o: Partial<MealItem> = {}): MealItem => ({
  name: 'ご飯', amount: 200, unit: 'g', caloriesKcal: 336, proteinG: 5, fatG: 0.6, carbsG: 74, fiberG: 0.6, saltG: 0, source: 'ai_text', confidence: 'medium', ...o,
});
const rawItem = { name: '唐揚げ', amount: 2, unit: '個', calories_kcal: 180, protein_g: 12, fat_g: 11, carbs_g: 8, fiber_g: null, salt_g: null, confidence: 'low' };

describe('AI応答の解析と文章による修正', () => {
  it('食品リストを変換し、null は null のまま', () => {
    const r = parseItemsResponse({ items: [rawItem], notes: 'n' }, 'ai_photo');
    expect(r.items[0]).toMatchObject({ name: '唐揚げ', caloriesKcal: 180, fiberG: null, saltG: null, source: 'ai_photo', confidence: 'low' });
  });
  it('不正な応答は拒否', () => expect(() => parseItemsResponse({ nope: 1 }, 'ai_text')).toThrow());
  it('scale はプログラムが計算する(AIの値を使わない)', () => {
    const p = parseOperationsResponse({ operations: [{ op: 'scale', item_index: 0, factor: 0.5, item: null }], notes: '' }, 1, 'ai_text');
    const r = applyOperations([base()], p.operations);
    expect(r.items[0].amount).toBe(100);
    expect(r.items[0].caloriesKcal).toBe(168);
    expect(r.diff[0].kind).toBe('scale');
  });
  it('remove / add / replace', () => {
    const p = parseOperationsResponse({
      operations: [
        { op: 'remove', item_index: 1, factor: null, item: null },
        { op: 'add', item_index: null, factor: null, item: rawItem },
        { op: 'replace', item_index: 0, factor: null, item: { ...rawItem, name: 'パン' } },
      ], notes: '',
    }, 2, 'ai_text');
    const r = applyOperations([base(), base({ name: 'みそ汁' })], p.operations);
    expect(r.items.map((i) => i.name)).toEqual(['パン', '唐揚げ']);
    expect(r.diff).toHaveLength(3);
  });
  it('範囲外の添字・不正なfactorは無視され、何も変更されない', () => {
    const p = parseOperationsResponse({ operations: [
      { op: 'scale', item_index: 5, factor: 0.5, item: null }, { op: 'scale', item_index: 0, factor: -1, item: null }, { op: 'remove', item_index: -1, factor: null, item: null },
    ], notes: 'x' }, 1, 'ai_text');
    expect(p.operations).toHaveLength(0);
    expect(p.warnings).toHaveLength(3);
    expect(applyOperations([base()], p.operations).items).toEqual([base()]);
  });
  it('解釈できない指示(operations空)は何も変更しない', () => {
    const p = parseOperationsResponse({ operations: [], notes: '解釈できません' }, 1, 'ai_text');
    expect(applyOperations([base()], p.operations)).toEqual({ items: [base()], diff: [] });
    expect(p.notes).toBe('解釈できません');
  });
});

import { diffMappings, parseLabelResponse, parseNumber, parseSheetResponse, resolveSheet, sheetToRecord } from './sheet';

const sheetJson = (o: object = {}) => ({
  measured_at: '2026-11-24T18:30', weight_kg: 70.2, body_fat_percent: 15.1, body_fat_kg: null, muscle_kg: null, skeletal_muscle_kg: 32.4,
  lean_body_mass_kg: null, visceral_fatlevel: 5, visceral_fat_level: null, body_water_l: null, bmi: null, bmr_kcal: null,
  raw_items: [{ label: '体重', value: '70.2kg' }, { label: '筋肉スコア', value: '３４．１ kg' }, { label: '体年齢', value: '28歳' }], ...o,
});

describe('体組成シートの読み取り', () => {
  it('シートにない項目は null のまま(値に含まれず、記録でも null)', () => {
    const p = parseSheetResponse(sheetJson());
    expect(p.values).toEqual({ weightKg: 70.2, bodyFatPercent: 15.1, skeletalMuscleKg: 32.4 });
    const rec = sheetToRecord(p, p.values, 'NOW');
    expect(rec.bodyFatKg).toBeNull(); expect(rec.muscleKg).toBeNull(); expect(rec.bmrKcal).toBeNull();
    expect(rec.measuredAt).toBe('2026-11-24T18:30'); expect(rec.source).toBe('ai_sheet');
  });
  it('不正な値(負数・文字列)は捨てる / 測定日時が不正なら null', () => {
    const p = parseSheetResponse(sheetJson({ weight_kg: -5, body_fat_percent: '15', measured_at: 'きのう' }));
    expect(p.values).toEqual({ skeletalMuscleKg: 32.4 });
    expect(p.measuredAt).toBeNull();
    expect(sheetToRecord(p, p.values, 'NOW').measuredAt).toBe('NOW');
  });
  it('raw_items が無い応答は拒否', () => expect(() => parseSheetResponse({ weight_kg: 1 })).toThrow());
  it('全角・単位つきの数値を読める', () => {
    expect(parseNumber('３４．１ kg')).toBe(34.1); expect(parseNumber('1,650kcal')).toBe(1650); expect(parseNumber('なし')).toBeNull();
  });
  it('保存済みの対応付けが次回の初期値になる', () => {
    const p = parseSheetResponse(sheetJson());
    const r = resolveSheet(p, [{ label: '筋肉スコア', field: 'muscleKg' }]);
    expect(r.values.muscleKg).toBe(34.1);
    expect(r.assignments).toEqual([null, 'muscleKg', null]);
    expect(resolveSheet(p, []).values.muscleKg).toBeUndefined(); // 対応が無ければ捏造しない
  });
  it('対応付けの保存・削除を決める', () => {
    const p = parseSheetResponse(sheetJson());
    const d = diffMappings(p.rawItems, [null, 'muscleKg', null], [{ label: '体重', field: 'weightKg' }]);
    expect(d.toSave).toEqual([{ label: '筋肉スコア', field: 'muscleKg' }]);
    expect(d.toDelete).toEqual(['体重']);
  });
});

describe('栄養成分表示の読み取り', () => {
  it('読み取れなかった項目を unread に挙げる(捏造しない)', () => {
    const l = parseLabelResponse({ product_name: 'プロテイン', serving_amount: 30, serving_unit: 'g', calories_kcal: 115, protein_g: 23, fat_g: 1.5, carbs_g: null, fiber_g: null, salt_g: 0.2 });
    expect(l.unread).toEqual(['炭水化物', '食物繊維']);
    expect(l.saltG).toBe(0.2); expect(l.fiberG).toBeNull();
  });
});
