import { useRef, useState } from 'react';
import { db, newId } from '../db';
import { buildBackup, clearAll, exportFile, parseBackup, restoreBackup } from '../lib/backup';
import { toLocalDateTime } from '../lib/dates';
import type { AppSettings } from '../types';
import type { AppData } from './useAppData';
import { ProfileGoalForm } from './ProfileGoalForm';
import { f1 } from './ui';

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

      <div className="card">
        <h2>AI機能</h2>
        <p className="muted">AI解析(Gemini無料枠)は段階2で追加されます。それまでは手入力・マイ食品・履歴コピーで記録できます。</p>
        {latest && <p className="muted">最新体重 {f1(latest.weightKg)}kg</p>}
      </div>
      {msg && <p className="warn">{msg}</p>}
    </div>
  );
}
