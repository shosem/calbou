import { useState } from 'react';
import { db, newId } from '../db';
import type { BodyComposition } from '../types';
import { toLocalDateTime } from '../lib/dates';
import type { AppData } from './useAppData';
import { NumField, f1 } from './ui';

const blank = (): BodyComposition => ({
  id: newId(), measuredAt: toLocalDateTime(), source: 'manual', weightKg: 0, bodyFatPercent: null, bodyFatKg: null,
  muscleKg: null, skeletalMuscleKg: null, leanBodyMassKg: null, visceralFatLevel: null, bodyWaterL: null, bmi: null, bmrKcal: null,
});

export function BodyScreen({ data }: { data: AppData }) {
  const [form, setForm] = useState<{ rec: BodyComposition; isNew: boolean } | null>(null);
  const list = [...data.body].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));

  if (form) {
    const r = form.rec;
    const p = (x: Partial<BodyComposition>) => setForm({ ...form, rec: { ...r, ...x } });
    return (
      <div className="card">
        <h2>{form.isNew ? '体組成を記録' : '体組成を編集'}</h2>
        <p className="muted">シートに載っている項目だけ入力し、ない項目は空欄のままで構いません。</p>
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
          <button disabled={!(r.weightKg > 0)} onClick={async () => { await db.body.put({ ...r, memo: r.memo || undefined }); setForm(null); }}>保存</button>
        </div>
        {!form.isNew && <button className="danger" style={{ width: '100%', marginTop: 12 }}
          onClick={async () => { if (confirm('削除しますか?')) { await db.body.delete(r.id); setForm(null); } }}>削除</button>}
      </div>
    );
  }
  return (
    <div>
      <h1>体組成・体重</h1>
      <button style={{ width: '100%', marginBottom: 12 }} onClick={() => setForm({ rec: blank(), isNew: true })}>＋ 体組成を記録</button>
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
