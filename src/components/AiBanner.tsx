import { clearTask, requestOpen, retryTask, useTask } from '../lib/aiTask';

/** タブバーのすぐ上に出すAI処理の状況表示 */
export function AiBanner({ go }: { go: (t: 'meals' | 'body') => void }) {
  const t = useTask();
  if (!t) return null;
  if (t.phase === 'running') {
    return (
      <div className="aibar running">
        <span>🔄 {t.label}…(他の画面を操作できます)</span>
        <button className="small sub fit" onClick={() => { if (confirm('処理を取り消しますか?(使用した1回分は戻りません)')) clearTask(); }}>取消</button>
      </div>
    );
  }
  if (t.phase === 'done') {
    return (
      <div className="aibar done" onClick={() => { go(t.tab); requestOpen(); }}>
        <span>✅ {t.doneLabel}</span><b>確認する ▶</b>
      </div>
    );
  }
  return (
    <div className="aibar error">
      <span>⚠ {t.error}{t.retryable && <span className="mini"> 同じ内容でもう一度送れます(1回消費)</span>}</span>
      {t.retryable && <button className="small fit" onClick={retryTask}>再試行</button>}
      <button className="small sub fit" onClick={clearTask}>閉じる</button>
    </div>
  );
}
