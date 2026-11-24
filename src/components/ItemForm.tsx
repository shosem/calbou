import { useState } from 'react';
import type { MealItem } from '../types';
import { rescaleToAmount } from '../lib/calc';
import { NumField } from './ui';

export const blankItem = (): MealItem => ({
  name: '', amount: 100, unit: 'g', caloriesKcal: 0, proteinG: 0, fatG: 0, carbsG: 0, fiberG: null, saltG: null, source: 'manual',
});

/** 1アイテムの編集フォーム。量を変えると比率で栄養素を再計算する(プログラムが計算) */
export function ItemForm({ initial, submitLabel, onSubmit, onCancel, showRescale = true }: {
  initial: MealItem; submitLabel: string; onSubmit: (i: MealItem) => void; onCancel: () => void; showRescale?: boolean;
}) {
  const [it, setIt] = useState<MealItem>(initial);
  const [base, setBase] = useState<MealItem>(initial); // 再計算の基準
  const [msg, setMsg] = useState('');
  const patch = (p: Partial<MealItem>) => setIt((x) => ({ ...x, ...p }));
  // 栄養素の手修正は新しい基準(現在の量での値)として保持し、後の量変更で失われないようにする
  const nut = (p: Partial<MealItem>) => { const next = { ...it, ...p }; setIt(next); setBase(next); };

  const changeAmount = (v: number | null) => {
    const n = v ?? 0;
    if (showRescale && base.amount > 0) {
      const r = rescaleToAmount(base, n);
      if (r) { setIt({ ...r, name: it.name, unit: it.unit }); setMsg(''); return; }
    }
    patch({ amount: n });
    if (showRescale && base.amount <= 0) setMsg('元の量が0のため自動再計算できません。栄養素を手入力してください。');
  };

  return (
    <div>
      <label>食品名</label>
      <input value={it.name} onChange={(e) => patch({ name: e.target.value })} placeholder="例:鶏むね肉" />
      <div className="grid2">
        <NumField label="量" value={it.amount} onChange={changeAmount} />
        <div><label>単位</label><input value={it.unit} onChange={(e) => patch({ unit: e.target.value })} placeholder="g / ml / 個 / スクープ" /></div>
      </div>
      {showRescale && <p className="muted">量を変えると、栄養素は元の量との比率で自動再計算されます(その後の手修正も可)。{msg && <span className="err"> {msg}</span>}</p>}
      <div className="grid2">
        <NumField label="カロリー(kcal)" value={it.caloriesKcal} onChange={(v) => nut({ caloriesKcal: v ?? 0 })} />
        <NumField label="たんぱく質(g)" value={it.proteinG} onChange={(v) => nut({ proteinG: v ?? 0 })} />
        <NumField label="脂質(g)" value={it.fatG} onChange={(v) => nut({ fatG: v ?? 0 })} />
        <NumField label="炭水化物(g)" value={it.carbsG} onChange={(v) => nut({ carbsG: v ?? 0 })} />
        <NumField label="食物繊維(g)" value={it.fiberG} nullable onChange={(v) => nut({ fiberG: v })} />
        <NumField label="塩分(g)" value={it.saltG} nullable onChange={(v) => nut({ saltG: v })} />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="sub" onClick={onCancel}>キャンセル</button>
        <button disabled={!it.name.trim()} onClick={() => onSubmit({ ...it, name: it.name.trim() })}>{submitLabel}</button>
      </div>
    </div>
  );
}
