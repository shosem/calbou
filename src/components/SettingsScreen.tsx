import { useRef, useState } from 'react';
import { db, newId } from '../db';
import { buildBackup, clearAll, exportFile, parseBackup, restoreBackup } from '../lib/backup';
import { toLocalDateTime } from '../lib/dates';
import type { AppSettings } from '../types';
import type { AppData } from './useAppData';
import { ProfileGoalForm } from './ProfileGoalForm';
import { f1 } from './ui';
import { CONSENT_TEXT, useAiStatus } from './AiPanel';
import { DAILY_AI_LIMIT, clearStopped } from '../lib/aiGuard';
import { GEMINI_MODEL, aiStore } from '../lib/gemini';
import { toLocalDate } from '../lib/dates';

export async function saveSettings(s: AppSettings, weightKg: number, currentWeight: number | null) {
  await db.settings.put({ ...s, onboarded: true });
  if (currentWeight == null || Math.abs(currentWeight - weightKg) > 1e-9) {
    await db.body.add({ id: newId(), measuredAt: toLocalDateTime(), source: 'quick', weightKg, bodyFatPercent: null, bodyFatKg: null, muscleKg: null, skeletalMuscleKg: null, leanBodyMassKg: null, visceralFatLevel: null, bodyWaterL: null, bmi: null, bmrKcal: null });
  }
}

export function SettingsScreen({ data, persisted }: { data: AppData; persisted: boolean | null }) {
  const { settings, latest } = data;
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!settings) return null;

  const doExport = async () => {
    const r = await exportFile(await buildBackup(db));
    if (r !== 'cancelled') {
      await db.settings.update('main', { lastBackupAt: new Date().toISOString() });
      setMsg(r === 'shared' ? '共有シートから保存先(iCloud Drive 等)を選んでください。' : 'ファイルをダウンロードしました。');
    }
  };
  const doImport = async (f: File) => {
    try {
      const b = parseBackup(await f.text());
      if (!confirm('現在のデータはすべて置き換えられます。読み込みますか?')) return;
      await restoreBackup(db, b);
      setMsg('読み込みが完了しました。');
    } catch (e) { setMsg(`読み込みに失敗: ${(e as Error).message}`); }
  };

  return (
    <div>
      <h1>設定</h1>
      <p className="muted">目標カロリー補正(承認済みの提案の累計): {settings.goal.calorieAdjustmentKcal >= 0 ? '+' : ''}{settings.goal.calorieAdjustmentKcal}kcal</p>
      <ProfileGoalForm key={settings.id + (saved ? 's' : '')} initial={settings} currentWeight={latest?.weightKg ?? null} submitLabel="設定を保存"
        onSubmit={async ({ settings: s, weightKg }) => { await saveSettings(s, weightKg, latest?.weightKg ?? null); setSaved((x) => !x); setMsg('保存しました。'); }} />

      <div className="card" style={{ marginTop: 12 }}>
        <h2>バックアップ</h2>
        <p className="muted">最終書き出し: {settings.lastBackupAt ? settings.lastBackupAt.replace('T', ' ').slice(0, 16) : '未実施'}(14日ごとを推奨)。APIキーはバックアップに含まれません。</p>
        <div className="row"><button onClick={doExport}>書き出し</button><button className="sub" onClick={() => fileRef.current?.click()}>読み込み</button></div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
        <button className="danger" style={{ width: '100%', marginTop: 12 }}
          onClick={async () => { if (confirm('全データを消去します。先にバックアップを取りましたか?') && confirm('本当に消去しますか?(元に戻せません)')) { await clearAll(db); location.reload(); } }}>全データを消去</button>
      </div>

      <div className="card">
        <h2>保存領域</h2>
        <p className="muted">永続ストレージ: {persisted == null ? '確認中' : persisted ? '許可されています' : '許可されていません(ブラウザの判断で消える可能性があります。定期バックアップを推奨)'}</p>
        <p className="muted">データは端末内(IndexedDB)にのみ保存されます。Safariのタブとホーム画面アプリは保存領域が別です。</p>
      </div>

      <AiSettings />
      {msg && <p className="warn">{msg}</p>}
    </div>
  );
}

function AiSettings() {
  const [key, setKey] = useState(aiStore.getKey());
  const [model, setModel] = useState(aiStore.getModelOverride());
  const [consent, setConsent] = useState(aiStore.hasConsent());
  const [note, setNote] = useState('');
  const st = useAiStatus();
  return (
    <div className="card">
      <h2>AI機能(Gemini 無料枠)</h2>
      <p className="muted">AI解析は、<b>課金(Billing)を有効化していないGoogle Cloudプロジェクト</b>で発行したAPIキーで使ってください。請求アカウントを紐づけると、無料枠を超えた分が課金される可能性があります。</p>
      <label>APIキー(この端末内にのみ保存。バックアップには含まれません)</label>
      <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza..." />
      <label>モデル名(空欄なら既定値 {GEMINI_MODEL})</label>
      <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={GEMINI_MODEL} />
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => { aiStore.setKey(key.trim()); aiStore.setModelOverride(model.trim()); setNote('AI設定を保存しました。'); }}>保存</button>
        <button className="danger" onClick={() => { aiStore.setKey(''); setKey(''); setNote('APIキーを削除しました。'); }}>キー削除</button>
      </div>
      <h3>利用状況</h3>
      <p>本日 {st.count}/{DAILY_AI_LIMIT} 回(写真・文章・修正のすべてを数えます){st.stopped && <span className="over"> ・停止中</span>}</p>
      {st.stopped && <button className="sub small" onClick={async () => { await clearStopped(db, toLocalDate()); setNote('停止状態を解除しました。'); }}>停止状態を解除</button>}
      <p className="muted">Google側の1日の上限は太平洋時間の0時にリセットされます(日本時間で冬は17時頃)。アプリが「本日は停止」でも、夕方以降にGoogle側の枠が回復している場合があります。その場合は「停止状態を解除」を使ってください。</p>
      <h3>データ送信への同意</h3>
      <p className="muted">{CONSENT_TEXT}</p>
      <p className="muted">現在: {consent ? '同意済み' : '未同意(AI機能は無効)'}</p>
      {consent && <button className="sub small" onClick={() => { aiStore.setConsent(false); setConsent(false); }}>同意を取り消す</button>}
      {note && <p className="warn">{note}</p>}
    </div>
  );
}
