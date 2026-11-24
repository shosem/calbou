import { useMemo, useState } from 'react';
import { db, newId } from '../db';
import type { Category, MealEntry, MealItem, MyFood } from '../types';
import { CATEGORIES, CATEGORY_LABEL, scaleItem, sumItems } from '../lib/calc';
import { addDays, toLocalDate } from '../lib/dates';
import type { AppData } from './useAppData';
import { ItemForm, blankItem } from './ItemForm';
import { NumField, f1 } from './ui';
import { AiPanel } from './AiPanel';

export async function addItemsToMeal(date: string, category: Category, items: MealItem[]) {
  await db.transaction('rw', db.meals, async () => {
    const found = await db.meals.where('date').equals(date).and((m) => m.category === category).first();
    if (found) await db.meals.update(found.id, { items: [...found.items, ...items] });
    else await db.meals.add({ id: newId(), date, category, items, createdAt: new Date().toISOString() });
  });
}
async function replaceItem(entry: MealEntry, idx: number, item: MealItem | null) {
  const items = entry.items.flatMap((x, i) => (i === idx ? (item ? [item] : []) : [x]));
  if (items.length === 0) await db.meals.delete(entry.id);
  else await db.meals.update(entry.id, { items });
}

export function MealsScreen({ data }: { data: AppData }) {
  const [date, setDate] = useState(toLocalDate());
  const [adding, setAdding] = useState<Category | null>(null);
  const [editing, setEditing] = useState<{ entry: MealEntry; idx: number } | null>(null);
  const entries = data.meals.filter((m) => m.date === date);

  if (adding) return <AddPanel data={data} category={adding} onClose={() => setAdding(null)} onAdd={async (items) => { await addItemsToMeal(date, adding, items); setAdding(null); }} />;
  if (editing) {
    const { entry, idx } = editing;
    return (
      <div className="card">
        <h2>{CATEGORY_LABEL[entry.category]}の食品を編集</h2>
        <ItemForm initial={entry.items[idx]} submitLabel="保存" onCancel={() => setEditing(null)}
          onSubmit={async (it) => { await replaceItem(entry, idx, it); setEditing(null); }} />
        <button className="danger" style={{ width: '100%', marginTop: 12 }}
          onClick={async () => { if (confirm('この食品を削除しますか?')) { await replaceItem(entry, idx, null); setEditing(null); } }}>削除</button>
      </div>
    );
  }

  const total = sumItems(entries.flatMap((e) => e.items));
  return (
    <div>
      <h1>食事記録</h1>
      <div className="row card">
        <button className="sub fit" onClick={() => setDate(addDays(date, -1))}>◀</button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="sub fit" onClick={() => setDate(addDays(date, 1))}>▶</button>
      </div>
      <p className="muted" style={{ textAlign: 'center' }}>合計 {Math.round(total.caloriesKcal)}kcal / P {f1(total.proteinG)} F {f1(total.fatG)} C {f1(total.carbsG)}</p>
      {CATEGORIES.map((c) => {
        const es = entries.filter((e) => e.category === c);
        const items = es.flatMap((e) => e.items.map((it, idx) => ({ e, it, idx })));
        const t = sumItems(items.map((x) => x.it));
        return (
          <div className="card" key={c}>
            <div className="row between"><h2 style={{ margin: 0 }}>{CATEGORY_LABEL[c]} <span className="muted">{Math.round(t.caloriesKcal)}kcal</span></h2>
              <button className="small fit" onClick={() => setAdding(c)}>＋追加</button></div>
            {items.map(({ e, it, idx }) => (
              <div className="item" key={e.id + idx} onClick={() => setEditing({ entry: e, idx })}>
                <div>{it.name}<div className="muted">{f1(it.amount)}{it.unit}</div></div>
                <div style={{ textAlign: 'right' }}>{Math.round(it.caloriesKcal)}kcal<div className="muted">P{f1(it.proteinG)} F{f1(it.fatG)} C{f1(it.carbsG)}</div></div>
              </div>
            ))}
            {items.length === 0 && <p className="muted">未記録</p>}
          </div>
        );
      })}
    </div>
  );
}

type Tab = 'manual' | 'photo' | 'text' | 'my' | 'history';

function AddPanel({ data, category, onClose, onAdd }: {
  data: AppData; category: Category; onClose: () => void; onAdd: (items: MealItem[]) => void;
}) {
  const [tab, setTab] = useState<Tab>('manual');
  return (
    <div className="card">
      <div className="row between"><h2>{CATEGORY_LABEL[category]}に追加</h2><button className="sub small fit" onClick={onClose}>閉じる</button></div>
      <div className="tabs">
        {([['manual', '手入力'], ['photo', '写真AI'], ['text', '文章AI'], ['my', 'マイ食品'], ['history', '履歴']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? '' : 'sub'} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'manual' && <ItemForm initial={blankItem()} submitLabel="追加" showRescale={false} onCancel={onClose} onSubmit={(it) => onAdd([it])} />}
      {(tab === 'photo' || tab === 'text') && <AiPanel key={tab} mode={tab} onSave={onAdd} onCancel={onClose} />}
      {tab === 'my' && <MyFoodPicker foods={data.myFoods} onPick={(it) => onAdd([it])} />}
      {tab === 'history' && <HistoryPicker data={data} onPick={(it) => onAdd([it])} />}
    </div>
  );
}

function MyFoodPicker({ foods, onPick }: { foods: MyFood[]; onPick: (i: MealItem) => void }) {
  const [sel, setSel] = useState<MyFood | null>(null);
  const [n, setN] = useState(1);
  const [edit, setEdit] = useState<MyFood | 'new' | null>(null);

  if (edit) return <MyFoodEditor initial={edit === 'new' ? null : edit} onDone={() => setEdit(null)} />;
  if (sel) {
    const base: MealItem = { name: sel.name, amount: sel.servingAmount, unit: sel.servingUnit, caloriesKcal: sel.caloriesKcal, proteinG: sel.proteinG, fatG: sel.fatG, carbsG: sel.carbsG, fiberG: sel.fiberG, saltG: sel.saltG, source: 'my_food' };
    const it = { ...scaleItem(base, n), source: 'my_food' as const };
    return (
      <div>
        <h3>{sel.name}(1回分 {sel.servingAmount}{sel.servingUnit})</h3>
        <NumField label="何回分(人前・スクープ数など)" value={n} onChange={(v) => setN(v ?? 0)} />
        <p className="muted">→ {f1(it.amount)}{it.unit} / {it.caloriesKcal}kcal P{it.proteinG} F{it.fatG} C{it.carbsG}</p>
        <div className="row"><button className="sub" onClick={() => setSel(null)}>戻る</button><button disabled={n <= 0} onClick={() => onPick(it)}>追加</button></div>
      </div>
    );
  }
  return (
    <div>
      <button className="sub small" onClick={() => setEdit('new')}>＋マイ食品を登録</button>
      {foods.length === 0 && <p className="muted">マイ食品はまだありません。</p>}
      {(['food', 'supplement'] as const).map((cat) => {
        const list = foods.filter((f) => f.category === cat);
        if (!list.length) return null;
        return (
          <div key={cat}>
            <h3>{cat === 'food' ? '食品' : 'プロテイン・サプリ'}</h3>
            {list.map((f) => (
              <div className="item" key={f.id}>
                <div onClick={() => { setSel(f); setN(1); }} style={{ flex: 1 }}>{f.name}<div className="muted">{f.servingAmount}{f.servingUnit} / {f.caloriesKcal}kcal P{f.proteinG}</div></div>
                <button className="sub small fit" onClick={() => setEdit(f)}>編集</button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function MyFoodEditor({ initial, onDone }: { initial: MyFood | null; onDone: () => void }) {
  const [category, setCategory] = useState<MyFood['category']>(initial?.category ?? 'food');
  const item: MealItem = initial
    ? { ...blankItem(), name: initial.name, amount: initial.servingAmount, unit: initial.servingUnit, caloriesKcal: initial.caloriesKcal, proteinG: initial.proteinG, fatG: initial.fatG, carbsG: initial.carbsG, fiberG: initial.fiberG, saltG: initial.saltG }
    : { ...blankItem(), unit: 'g' };
  return (
    <div>
      <h3>{initial ? 'マイ食品を編集' : 'マイ食品を登録'}(量=1回分の量、栄養素はその量あたり)</h3>
      <label>カテゴリ</label>
      <select value={category} onChange={(e) => setCategory(e.target.value as MyFood['category'])}>
        <option value="food">食品</option><option value="supplement">プロテイン・サプリ</option>
      </select>
      <ItemForm initial={item} submitLabel="保存" showRescale={false} onCancel={onDone}
        onSubmit={async (it) => {
          const f: MyFood = { id: initial?.id ?? newId(), name: it.name, category, servingAmount: it.amount, servingUnit: it.unit, caloriesKcal: it.caloriesKcal, proteinG: it.proteinG, fatG: it.fatG, carbsG: it.carbsG, fiberG: it.fiberG, saltG: it.saltG };
          await db.myFoods.put(f); onDone();
        }} />
      {initial && <button className="danger" style={{ width: '100%', marginTop: 8 }}
        onClick={async () => { if (confirm('削除しますか?')) { await db.myFoods.delete(initial.id); onDone(); } }}>削除</button>}
    </div>
  );
}

function HistoryPicker({ data, onPick }: { data: AppData; onPick: (i: MealItem) => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const seen = new Set<string>();
    const out: MealItem[] = [];
    for (const m of [...data.meals].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))) {
      for (const it of m.items) {
        const key = `${it.name}|${it.amount}|${it.unit}|${it.caloriesKcal}`;
        if (seen.has(key)) continue;
        seen.add(key); out.push(it);
      }
    }
    return out.filter((i) => i.name.includes(q.trim())).slice(0, 50);
  }, [data.meals, q]);
  return (
    <div>
      <input placeholder="食品名で検索" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length === 0 && <p className="muted">該当する履歴がありません。</p>}
      {list.map((it, i) => (
        <div className="item" key={i} onClick={() => onPick({ ...it, source: 'history' })}>
          <div>{it.name}<div className="muted">{f1(it.amount)}{it.unit}</div></div>
          <div>{Math.round(it.caloriesKcal)}kcal</div>
        </div>
      ))}
    </div>
  );
}
