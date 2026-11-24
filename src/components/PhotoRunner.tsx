import { useRef, useState } from 'react';
import { DAILY_AI_LIMIT } from '../lib/aiGuard';
import { aiUnavailableReason } from '../lib/gemini';
import { resizeToJpegBase64 } from '../lib/image';
import { startTask, useTask, type TaskKind, type TaskTab } from '../lib/aiTask';
import { ConsentCard, useAiStatus } from './AiPanel';

type Img = { mimeType: string; data: string };

/** 写真1枚を選んでAI解析を「裏で」開始する共通部品(利用可否ガード込み)。画像は解析開始後に破棄する */
export function PhotoRunner({ notice, kind, label, doneLabel, tab, run, onStarted, onCancel }: {
  notice: string; kind: TaskKind; label: string; doneLabel: string; tab: TaskTab;
  run: (img: Img) => Promise<unknown>; onStarted: () => void; onCancel: () => void;
}) {
  const [, force] = useState(0);
  const status = useAiStatus();
  const task = useTask();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const why = aiUnavailableReason();
  if (why === 'no_key' || why === 'no_model') return <p className="warn">AI機能を使うには、設定画面でGemini APIキー{why === 'no_model' ? 'とモデル名' : ''}を入力してください。手入力は使えます。</p>;
  if (why === 'no_consent') return <ConsentCard onAgree={() => force((x) => x + 1)} onDecline={onCancel} />;
  if (!status.guard.ok) return <p className="warn">{status.guard.reason === 'limit' ? '本日の上限に達しました。手入力は使えます。' : '本日はAI解析を停止中です(無料枠の上限)。手入力は使えます。設定画面で停止状態を解除できます。'}</p>;
  if (task) return <p className="warn">別のAI処理が進行中、または結果の確認待ちです(同時に実行できるのは1件です)。完了を確認してから開始してください。手入力は使えます。</p>;

  const go = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setErr(''); setBusy(true);
    try {
      const img = await resizeToJpegBase64(f);
      if (fileRef.current) fileRef.current.value = ''; // ファイル参照を切る
      setName('');
      if (startTask({ kind, label, doneLabel, tab }, () => run(img))) onStarted(); else setErr('別のAI処理が進行中です。');
    } catch { setErr('画像の読み込みに失敗しました。別の写真を試すか、手入力してください。'); } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="warn">{notice}</p>
      <p className="muted">AI解析はオンライン必須です。本日 {status.count}/{DAILY_AI_LIMIT} 回使用。写真は端末にも外部にも保存されません(解析のため Google に送信されます)。解析は裏で進み、完了すると画面下に表示されます。</p>
      <input ref={fileRef} type="file" accept="image/*" onChange={(e) => setName(e.target.files?.[0]?.name ?? '')} />
      {err && <p className="err">{err}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="sub" onClick={onCancel}>キャンセル</button>
        <button disabled={busy || !name} onClick={go}>{busy ? '準備中…' : 'AIで読み取り(1回消費)'}</button>
      </div>
    </div>
  );
}
