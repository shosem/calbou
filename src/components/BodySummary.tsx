import { useState } from 'react';
import { compareMetric, metricSeries, type CompareMode } from '../lib/calc';
import { mmdd, toLocalDate } from '../lib/dates';
import type { BodyComposition } from '../types';
import type { AppData } from './useAppData';
import { f1 } from './ui';

const MODES: [CompareMode, string][] = [['prev', '前回'], ['avg7', '7日平均'], ['avg30', '1ヶ月平均']];
const METRICS: { key: string; label: string; unit: string; digits: number; get: (b: BodyComposition) => number | null }[] = [
  { key: 'w', label: '体重', unit: 'kg', digits: 1, get: (b) => b.weightKg },
  { key: 'bf', label: '体脂肪率', unit: '%', digits: 1, get: (b) => b.bodyFatPercent },
  { key: 'mu', label: '筋肉量', unit: 'kg', digits: 1, get: (b) => b.skeletalMuscleKg ?? b.muscleKg },
  { key: 'bmr', label: '基礎代謝', unit: 'kcal', digits: 0, get: (b) => b.bmrKcal },
];

/** 今日(記録が無い項目は最新)の体組成と、前回 / 7日平均 / 1ヶ月平均との差 */
export function BodySummary({ data }: { data: AppData }) {
  const [mode, setMode] = useState<CompareMode>('prev');
  const today = toLocalDate();
  const fmt = (n: number, d: number) => (d === 0 ? String(Math.round(n)) : f1(n));
  const cells = METRICS.map((m) => ({ m, r: compareMetric(metricSeries(data.body, m.get), today, mode) }));
  const allToday = cells.some((c) => c.r.current) && cells.every((c) => !c.r.current || c.r.current.date === today);

  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>{allToday ? '今日の体組成' : '最新の体組成'}</h2></div>
      <div className="tabs" style={{ marginTop: 8 }}>
        {MODES.map(([k, l]) => <button key={k} className={mode === k ? 'small' : 'small sub'} onClick={() => setMode(k)}>{l}との差</button>)}
      </div>
      <div className="grid2">
        {cells.map(({ m, r }) => {
          const calcBmr = m.key === 'bmr' && !r.current && data.targets;
          return (
            <div className="metric" key={m.key}>
              <div className="mini">{m.label}</div>
              {r.current ? (
                <>
                  <div className="v">{fmt(r.current.v, m.digits)}<span className="mini">{m.unit}</span></div>
                  <div className="mini">{r.current.date === today ? '今日' : mmdd(r.current.date)}</div>
                  <div className="diff">
                    {r.diff == null ? <span className="mini">比較対象なし</span>
                      : Math.abs(r.diff) < 0.5 * 10 ** -m.digits ? <span>±0</span>
                      : <span>{r.diff > 0 ? '▲' : '▼'}{fmt(Math.abs(r.diff), m.digits)}{m.unit}</span>}
                    {r.base != null && <span className="mini"> (基準 {fmt(r.base, m.digits)})</span>}
                  </div>
                </>
              ) : calcBmr ? (
                <>
                  <div className="v">{data.targets!.bmr}<span className="mini">{m.unit}</span></div>
                  <div className="mini">計算値(シート記載なし)</div>
                </>
              ) : <div className="v mini">—</div>}
            </div>
          );
        })}
      </div>
      <p className="mini">平均は、現在値の測定日より前の7日間・30日間の記録から計算します(同日の複数回は最新値)。</p>
    </div>
  );
}
