import { useState } from 'react';
import { db, newId } from '../db';
import { CATEGORIES, CATEGORY_LABEL, backupDue, sumEntries, sumItems } from '../lib/calc';
import { toLocalDate, toLocalDateTime } from '../lib/dates';
import type { AppData } from './useAppData';
import { Bar, NumField, f1 } from './ui';

export function HomeScreen({ data, go }: { data: AppData; go: (t: 'meals' | 'settings') => void }) {
  const { settings, targets, latest } = data;
  const [w, setW] = useState<number | null>(null);
  const today = toLocalDate();
  const entries = data.meals.filter((m) => m.date === today);
  const total = sumEntries(entries);
  if (!settings || !targets || !latest) return null;
  const remain = targets.calories - total.caloriesKcal;
  const sorted = [...data.body].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const latestFat = sorted.find((b) => b.bodyFatPercent != null);

  const rows: [string, number, number][] = [
    ['たんぱく質', total.proteinG, targets.proteinG],
    ['脂質', total.fatG, targets.fatG],
    ['炭水化物', total.carbsG, targets.carbsG],
  ];
  return (
    <div>
      <h1>ホーム</h1>
      {backupDue(settings.lastBackupAt) && (
        <p className="warn" onClick={() => go('settings')}>バックアップを取りましょう(最終: {settings.lastBackupAt ? settings.lastBackupAt.slice(0, 10) : '未実施'})。設定画面から書き出せます。</p>
      )}
      <div className="card">
        <div className="muted">今日の残りカロリー(目標 {targets.calories}kcal)</div>
        <div className={`big ${remain < 0 ? 'over' : ''}`}>{remain >= 0 ? Math.round(remain) : `${Math.round(-remain)} 超過`}<span className="muted"> kcal</span></div>
        <Bar value={total.caloriesKcal} max={targets.calories} over={remain < 0} />
        <div className="muted">摂取 {Math.round(total.caloriesKcal)}kcal</div>
        {rows.map(([n, v, t]) => (
          <div key={n} style={{ marginTop: 8 }}>
            <div className="row between"><span>{n}</span><span className="fit">{f1(v)} / {t}g(あと {f1(Math.max(0, t - v))}g)</span></div>
            <Bar value={v} max={t} over={v > t * 1.1} />
          </div>
        ))}
        <div className="grid2 muted">
          <span>食物繊維 {f1(total.fiberG)} / {targets.fiberG}g {total.fiberG < targets.fiberG ? '(不足気味)' : '✓'}</span>
          <span className={total.saltG > targets.saltG ? 'over' : ''}>塩分 {f1(total.saltG)} / {targets.saltG}g未満{total.saltG > targets.saltG ? '(超過)' : ''}</span>
        </div>
      </div>

      <div className="card">
        <h2>今日の体重</h2>
        <div className="row">
          <NumField label="体重(kg)" value={w} nullable onChange={setW} />
          <button className="fit" style={{ alignSelf: 'flex-end' }} disabled={!w || w <= 0}
            onClick={async () => {
              await db.body.add({ id: newId(), measuredAt: toLocalDateTime(), source: 'quick', weightKg: w!, bodyFatPercent: null, bodyFatKg: null, muscleKg: null, skeletalMuscleKg: null, leanBodyMassKg: null, visceralFatLevel: null, bodyWaterL: null, bmi: null, bmrKcal: null });
              setW(null);
            }}>記録</button>
        </div>
        <p className="muted">直近: {f1(latest.weightKg)}kg({latest.measuredAt.slice(0, 10)}){latestFat ? ` / 体脂肪率 ${f1(latestFat.bodyFatPercent!)}%(${latestFat.measuredAt.slice(0, 10)})` : ''}</p>
        <p className="muted">基礎代謝 {targets.bmr}kcal / TDEE {targets.tdee}kcal</p>
      </div>

      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>今日の食事</h2><button className="small fit" onClick={() => go('meals')}>記録する</button></div>
        {CATEGORIES.map((c) => {
          const items = entries.filter((e) => e.category === c).flatMap((e) => e.items);
          return (
            <div key={c}>
              <h3>{CATEGORY_LABEL[c]} {items.length > 0 && `${Math.round(sumItems(items).caloriesKcal)}kcal`}</h3>
              {items.length === 0 ? <div className="muted">未記録</div> : items.map((it, i) => <div key={i} className="muted" style={{ color: 'inherit', fontSize: 14 }}>{it.name} {f1(it.amount)}{it.unit} ・ {Math.round(it.caloriesKcal)}kcal</div>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
