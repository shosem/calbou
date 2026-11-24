import { useState } from 'react';
import { db, newId } from '../db';
import type { BodyComposition } from '../types';
import { toLocalDateTime } from '../lib/dates';
import type { AppData } from './useAppData';
import { NumField, f1 } from './ui';
import { PhotoRunner } from './PhotoRunner';
import { BodySummary } from './BodySummary';
import { useConsume } from '../lib/aiTask';
import { analyzeSheet } from '../lib/aiPrompts';
import { FIELD_LABEL, NUM_FIELDS, diffMappings, parseNumber, resolveSheet, sheetToRecord, type NumField as NF, type SheetParse } from '../lib/sheet';

const blank = (): BodyComposition => ({
  id: newId(), measuredAt: toLocalDateTime(), source: 'manual', weightKg: 0, bodyFatPercent: null, bodyFatKg: null,
  muscleKg: null, skeletalMuscleKg: null, leanBodyMassKg: null, visceralFatLevel: null, bodyWaterL: null, bmi: null, bmrKcal: null,
});

export function BodyScreen({ data }: { data: AppData }) {
  const [form, setForm] = useState<{ rec: BodyComposition; isNew: boolean; sheet?: { raw: SheetParse['rawItems']; assign: (NF | null)[] } } | null>(null);
  const [scan, setScan] = useState(false);
  // バックグラウンドで完了した読み取り結果を、確認・修正フォームとして開く(バナーをタップしたとき)
  useConsume(['sheet'], (t) => {
    const { p, r } = t.result as { p: SheetParse; r: ReturnType<typeof resolveSheet> };
    setForm({ rec: { id: newId(), ...sheetToRecord(p, r.values, toLocalDateTime()) }, isNew: true, sheet: { raw: p.rawItems, assign: r.assignments } });
  });
  const list = [...data.body].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));

  if (scan) {
    return (
      <div className="card">
        <h2>シートを写真で読み取る</h2>
        <PhotoRunner
          notice="撮影前に:氏名・会員番号などが写らないようにしてください(写真は Google に送信されます)。"
          kind="sheet" label="体組成シートを読み取り中" doneLabel="体組成シートの読み取りが完了しました" tab="body"
          run={async (img) => {
            const p = await analyzeSheet(db, img);
            return { p, r: resolveSheet(p, await db.sheetMappings.toArray()) };
          }}
          onCancel={() => setScan(false)}
          onStarted={() => setScan(false)} />
      </div>
    );
  }
  if (form) {
    const r = form.rec;
    const p = (x: Partial<BodyComposition>) => setForm({ ...form, rec: { ...r, ...x } });
    return (
      <div className="card">
        <h2>{form.isNew ? '体組成を記録' : '体組成を編集'}</h2>
        <p className="muted">{form.sheet ? '読み取り結果です。「読み取れませんでした」の項目は空欄です。内容を確認・修正して保存してください(保存するまで記録されません)。' : 'シートに載っている項目だけ入力し、ない項目は空欄のままで構いません。'}</p>
        {form.sheet && (
          <div className="card" style={{ background: '#f9fafb' }}>
            <h3>シートの項目と記録項目の対応(変更した対応は次回の初期値になります)</h3>
            {form.sheet.raw.length === 0 && <p className="muted">項目を読み取れませんでした。</p>}
            {form.sheet.raw.map((it, i) => (
              <div className="row" key={i} style={{ marginBottom: 6 }}>
                <div style={{ flex: 2 }}>{it.label}<div className="muted">{it.value}</div></div>
                <select value={form.sheet!.assign[i] ?? ''} onChange={(e) => {
                  const f = (e.target.value || null) as NF | null;
                  const assign = form.sheet!.assign.map((a, j) => (j === i ? f : a));
                  const n = parseNumber(it.value);
                  setForm({ ...form, rec: f && n != null ? { ...r, [f]: n } : r, sheet: { ...form.sheet!, assign } });
                }}>
                  <option value="">対応なし</option>
                  {NUM_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
        <label>測定日時</label>
        <input type="datetime-local" value={r.measuredAt} onChange={(e) => e.target.value && p({ measuredAt: e.target.value })} />
        <div className="grid2">
          <NumField label="体重(kg)" value={r.weightKg || null} onChange={(v) => p({ weightKg: v ?? 0 })} />
          <NumField label="体脂肪率(%)" value={r.bodyFatPercent} nullable onChange={(v) => p({ bodyFatPercent: v })} />
          <NumField label="体脂肪量(kg)" value={r.bodyFatKg} nullable onChange={(v) => p({ bodyFatKg: v })} />
          <NumField label="筋肉量(kg)" value={r.muscleKg} nullable onChange={(v) => p({ muscleKg: v })} />
          <NumField label="骨格筋量(kg)" value={r.skeletalMuscleKg} nullable onChange={(v) => p({ skeletalMuscleKg: v })} />
          <NumField label="除脂肪体重(kg)" value={r.leanBodyMassKg} nullable onChange={(v) => p({ leanBodyMassKg: v })} />
          <NumField label="内臓脂肪レベル" value={r.visceralFatLevel} nullable onChange={(v) => p({ visceralFatLevel: v })} />
          <NumField label="体水分量(L)" value={r.bodyWaterL} nullable onChange={(v) => p({ bodyWaterL: v })} />
          <NumField label="BMI" value={r.bmi} nullable onChange={(v) => p({ bmi: v })} />
          <NumField label="基礎代謝(シート記載値 kcal)" value={r.bmrKcal} nullable onChange={(v) => p({ bmrKcal: v })} />
        </div>
        <label>メモ</label>
        <input value={r.memo ?? ''} onChange={(e) => p({ memo: e.target.value })} placeholder="例:トレーニング後" />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="sub" onClick={() => setForm(null)}>キャンセル</button>
          <button disabled={!(r.weightKg > 0)} onClick={async () => { await db.body.put({ ...r, memo: r.memo || undefined });
            if (form.sheet) {
              const d = diffMappings(form.sheet.raw, form.sheet.assign, await db.sheetMappings.toArray());
              await db.sheetMappings.bulkPut(d.toSave);
              await db.sheetMappings.bulkDelete(d.toDelete);
            }
            setForm(null); }}>保存</button>
        </div>
        {!form.isNew && <button className="danger" style={{ width: '100%', marginTop: 12 }}
          onClick={async () => { if (confirm('削除しますか?')) { await db.body.delete(r.id); setForm(null); } }}>削除</button>}
      </div>
    );
  }
  return (
    <div>
      <h1>体組成・体重</h1>
      <BodySummary data={data} />
      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={() => setForm({ rec: blank(), isNew: true })}>＋ 手入力で記録</button>
        <button className="sub" onClick={() => setScan(true)}>📷 シートを読み取る</button>
      </div>
      <div className="card">
        {list.length === 0 && <p className="muted">記録がありません。</p>}
        {list.map((b) => (
          <div className="item" key={b.id} onClick={() => setForm({ rec: b, isNew: false })}>
            <div>{b.measuredAt.replace('T', ' ')}<div className="muted">{b.source === 'quick' ? 'クイック入力' : b.memo ?? ''}</div></div>
            <div style={{ textAlign: 'right' }}>{f1(b.weightKg)}kg<div className="muted">{b.bodyFatPercent != null ? `${f1(b.bodyFatPercent)}%` : ''}{b.muscleKg != null ? ` 筋${f1(b.muscleKg)}kg` : ''}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}
