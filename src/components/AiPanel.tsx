import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { MealItem } from '../types';
import { DAILY_AI_LIMIT, checkUsage } from '../lib/aiGuard';
import { AiError, aiStore, aiUnavailableReason } from '../lib/gemini';
import { applyOperations, type DiffEntry, type Operation } from '../lib/aiParse';
import { analyzePhoto, analyzeText, requestCorrection } from '../lib/aiPrompts';
import { resizeToJpegBase64 } from '../lib/image';
import { toLocalDate } from '../lib/dates';
import { ItemForm } from './ItemForm';
import { f1 } from './ui';

export const CONSENT_TEXT = '無料枠では、送信した写真・文章を Google が製品の改善等に利用します(人間のレビュアーが内容を見る場合があります)。個人が特定される内容を送らないでください。記録データ自体は端末内にのみ保存され、送信されるのは解析リクエスト(写真・文章)だけです。';

export function useAiStatus() {
  const usage = useLiveQuery(async () => (await db.aiUsage.get(toLocalDate())) ?? null, []);
  const guard = checkUsage(usage ?? undefined);
  return { count: usage?.count ?? 0, guard, stopped: !!usage?.stopped };
}

export function ConsentCard({ onAgree, onDecline }: { onAgree: () => void; onDecline: () => void }) {
  return (
    <div>
      <p className="warn">{CONSENT_TEXT}</p>
      <div className="row">
        <button className="sub" onClick={onDecline}>同意しない</button>
        <button onClick={() => { aiStore.setConsent(true); onAgree(); }}>同意してAIを使う</button>
      </div>
    </div>
  );
}

const errText = (e: unknown) => (e instanceof AiError ? e.message : 'AIの呼び出しで予期しないエラーが発生しました。手入力に切り替えてください。');

/** 写真/文章のAI入力 → 確認・修正画面 → 保存。確認画面を経ずに保存される経路はない */
export function AiPanel({ mode, onSave, onCancel }: { mode: 'photo' | 'text'; onSave: (items: MealItem[]) => void; onCancel: () => void }) {
  const [, force] = useState(0);
  const status = useAiStatus();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ items: MealItem[]; notes: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');

  const why = aiUnavailableReason();
  if (why === 'no_key' || why === 'no_model') return <p className="warn">AI機能を使うには、設定画面でGemini APIキー{why === 'no_model' ? 'とモデル名' : ''}を入力してください。手入力・マイ食品・履歴は使えます。</p>;
  if (why === 'no_consent') return <ConsentCard onAgree={() => force((x) => x + 1)} onDecline={onCancel} />;
  if (!status.guard.ok) return <p className="warn">{status.guard.reason === 'limit' ? '本日の上限に達しました。手入力・マイ食品は使えます。' : '本日はAI解析を停止中です(無料枠の上限)。手入力・マイ食品は使えます。設定画面で停止状態を解除できます。'}</p>;

  if (result) return <Review initial={result} onSave={onSave} onCancel={() => { setResult(null); onCancel(); }} />;

  const run = async () => {
    setErr(''); setBusy(true);
    try {
      if (mode === 'photo') {
        const f = fileRef.current?.files?.[0];
        if (!f) return;
        const img = await resizeToJpegBase64(f);
        if (fileRef.current) fileRef.current.value = ''; // ファイル参照を切る
        setFileName('');
        setResult(await analyzePhoto(db, img, text));
      } else setResult(await analyzeText(db, text));
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="muted">AI解析はオンライン必須です。本日 {status.count}/{DAILY_AI_LIMIT} 回使用。写真は端末にも外部にも保存されません(解析のため Google に送信されます)。</p>
      {mode === 'photo' && (
        <>
          <input ref={fileRef} type="file" accept="image/*" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
          <label>補足(任意)</label>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="例:ご飯は大盛り" />
        </>
      )}
      {mode === 'text' && (
        <>
          <label>食べたものを書く</label>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="例:牛丼並とみそ汁、サラダ少し" />
        </>
      )}
      {err && <p className="err">{err}</p>}
      <button style={{ width: '100%', marginTop: 12 }} disabled={busy || (mode === 'photo' ? !fileName : !text.trim())} onClick={run}>{busy ? '解析中…' : 'AIで解析(1回消費)'}</button>
    </div>
  );
}

function Review({ initial, onSave, onCancel }: { initial: { items: MealItem[]; notes: string }; onSave: (i: MealItem[]) => void; onCancel: () => void }) {
  const [items, setItems] = useState(initial.items);
  const [notes, setNotes] = useState(initial.notes);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [instr, setInstr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<{ items: MealItem[]; diff: DiffEntry[]; notes: string; warnings: string[] } | null>(null);
  const status = useAiStatus();
  const source = items[0]?.source ?? 'ai_text';

  if (editIdx !== null) {
    return <ItemForm initial={items[editIdx]} submitLabel="反映" onCancel={() => setEditIdx(null)}
      onSubmit={(it) => { setItems(items.map((x, i) => (i === editIdx ? it : x))); setEditIdx(null); }} />;
  }

  const askCorrection = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await requestCorrection(db, items, instr, source);
      setPending({ ...applyOperations(items, r.operations as Operation[]), notes: r.notes, warnings: r.warnings });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <h3>確認・修正(保存するまで記録されません)</h3>
      {notes && <p className="muted">AIのメモ: {notes}</p>}
      {items.length === 0 && <p className="warn">食品を読み取れませんでした。手入力に切り替えるか、文章を変えて試してください。</p>}
      {items.map((it, i) => (
        <div className="item" key={i} onClick={() => setEditIdx(i)}>
          <div>{it.name} {it.confidence && <span className="muted">[信頼度:{{ high: '高', medium: '中', low: '低' }[it.confidence]}]</span>}
            <div className="muted">{f1(it.amount)}{it.unit} ・ 繊維{it.fiberG == null ? '読み取れませんでした' : `${f1(it.fiberG)}g`} ・ 塩分{it.saltG == null ? '読み取れませんでした' : `${f1(it.saltG)}g`}</div></div>
          <div style={{ textAlign: 'right' }}>{Math.round(it.caloriesKcal)}kcal<div className="muted">P{f1(it.proteinG)} F{f1(it.fatG)} C{f1(it.carbsG)}</div>
            <button className="danger small" onClick={(e) => { e.stopPropagation(); setItems(items.filter((_, j) => j !== i)); }}>削除</button></div>
        </div>
      ))}

      {pending ? (
        <div className="card" style={{ background: '#f9fafb' }}>
          <h3>変更内容(変更前 → 変更後)</h3>
          {pending.notes && <p className="muted">AIの解釈: {pending.notes}</p>}
          {pending.warnings.map((w, i) => <p className="warn" key={i}>{w}</p>)}
          {pending.diff.length === 0 && <p className="warn">変更はありません(指示を解釈できませんでした)。</p>}
          {pending.diff.map((d, i) => (
            <div className="item" key={i}>
              <div>{d.kind === 'add' ? '追加' : d.kind === 'remove' ? '削除' : d.kind === 'scale' ? '量の変更' : '置換'}</div>
              <div style={{ textAlign: 'right' }}>
                {d.before && <div>{d.before.name} {f1(d.before.amount)}{d.before.unit} {Math.round(d.before.caloriesKcal)}kcal</div>}
                {d.after && <div>→ {d.after.name} {f1(d.after.amount)}{d.after.unit} {Math.round(d.after.caloriesKcal)}kcal</div>}
                {d.kind === 'remove' && <div>→ なし</div>}
              </div>
            </div>
          ))}
          <div className="row"><button className="sub" onClick={() => setPending(null)}>やめる</button>
            <button disabled={pending.diff.length === 0} onClick={() => { setItems(pending.items); setNotes(pending.notes); setPending(null); setInstr(''); }}>適用</button></div>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <label>文章で修正(例:ご飯は半分 / 唐揚げを2個追加 / みそ汁は無し)</label>
          <div className="row"><input value={instr} onChange={(e) => setInstr(e.target.value)} />
            <button className="sub fit" disabled={busy || !instr.trim() || !status.guard.ok} onClick={askCorrection}>{busy ? '…' : '修正(1回消費)'}</button></div>
          {!status.guard.ok && <p className="muted">本日はAIを使えません。各食品をタップして手で修正できます。</p>}
          {err && <p className="err">{err}</p>}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="sub" onClick={onCancel}>キャンセル(破棄)</button>
        <button disabled={items.length === 0 || !!pending} onClick={() => onSave(items)}>保存</button>
      </div>
    </div>
  );
}
