import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, newId } from '../db';
import { REVIEW_INTERVAL_DAYS, approveProposal, evaluateAdjustment, rejectProposal, reviewDue, saveEvaluation, type Evaluation } from '../lib/proposal';
import { toLocalDate } from '../lib/dates';
import type { AppData } from './useAppData';

const sign = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** 目標カロリーの調整提案。提案のみ行い、承認するまで目標値は変えない */
export function ProposalCard({ data }: { data: AppData }) {
  const history = useLiveQuery(() => db.proposals.orderBy('createdAt').reverse().toArray(), []);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [busy, setBusy] = useState(false);
  if (!history || !data.settings) return null;

  const pending = history.find((h) => h.status === 'pending');
  const due = reviewDue(history);
  const last = history[0];
  const nextDate = last ? new Date(new Date(last.createdAt).getTime() + REVIEW_INTERVAL_DAYS * 86400000) : null;

  const run = async () => {
    setBusy(true);
    try {
      const ev = evaluateAdjustment({ mode: data.settings!.goal.mode, today: toLocalDate(), body: data.body, meals: data.meals });
      setResult(ev);
      await saveEvaluation(db, ev, newId());
    } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h2>目標カロリーの調整提案</h2>
      <p className="muted">2週間ごとに進捗を判定し、変更を提案します。承認するまで目標カロリーは変わりません。現在の補正: {sign(data.settings.goal.calorieAdjustmentKcal)}kcal</p>

      {pending && (
        <div className="warn">
          <b>提案: {sign(pending.deltaKcal)}kcal</b>
          <div>{pending.reason}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="sub" onClick={() => rejectProposal(db, pending.id)}>却下</button>
            <button onClick={() => approveProposal(db, pending.id)}>承認して反映</button>
          </div>
        </div>
      )}

      {!pending && result?.status === 'none' && <p className={result.onTrack ? 'muted' : 'warn'}>提案なし: {result.reason}</p>}
      {!pending && result?.status === 'insufficient' && (
        <div className="warn">判定に必要な記録が足りません。{result.missing.map((m, i) => <div key={i}>・{m}</div>)}</div>
      )}

      {!pending && (due
        ? <button style={{ width: '100%' }} disabled={busy} onClick={run}>進捗を判定する(判定の時期です)</button>
        : <p className="muted">次回の判定は {nextDate && toLocalDate(nextDate)} 以降です。</p>)}

      {history.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="muted">提案履歴</summary>
          {history.slice(0, 10).map((h) => (
            <div className="item" key={h.id}>
              <div>{h.createdAt.slice(0, 10)}<div className="muted">{h.reason}</div></div>
              <div className="fit" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {h.deltaKcal === 0 ? '提案なし' : `${sign(h.deltaKcal)}kcal`}
                <div className="muted">{h.deltaKcal === 0 ? '' : { pending: '保留中', approved: '承認', rejected: '却下' }[h.status]}</div>
              </div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
