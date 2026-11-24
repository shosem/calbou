import { useEffect, useState } from 'react';
import type { AppSettings } from './types';
import { suggestActivityFactor } from './lib/calc';
import { addDays, toLocalDate } from './lib/dates';
import { useAppData } from './components/useAppData';
import { ProfileGoalForm } from './components/ProfileGoalForm';
import { saveSettings, SettingsScreen } from './components/SettingsScreen';
import { HomeScreen } from './components/HomeScreen';
import { MealsScreen } from './components/MealsScreen';
import { BodyScreen } from './components/BodyScreen';
import { GraphScreen } from './components/GraphScreen';

type Tab = 'home' | 'meals' | 'body' | 'graph' | 'settings';
const TABS: [Tab, string][] = [['home', 'ホーム'], ['meals', '食事'], ['body', '体組成'], ['graph', 'グラフ'], ['settings', '設定']];

const defaultSettings = (): AppSettings => {
  const today = toLocalDate();
  return {
    id: 'main',
    profile: { sex: 'male', age: 30, heightCm: 170, activityFactor: suggestActivityFactor('desk', 3) },
    goal: { targetWeightKg: 70, targetBodyFatPercent: 15, startDate: today, targetDate: addDays(today, 180), mode: 'recomp', calorieAdjustmentKcal: 0 },
    jobActivity: 'desk', trainingPerWeek: 3, proteinCoef: 2.2, onboarded: false, lastBackupAt: null,
  };
};

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export default function App() {
  const data = useAppData();
  const [tab, setTab] = useState<Tab>('home');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [skipA2HS, setSkipA2HS] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setPersisted((await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false);
      } catch { setPersisted(false); }
    })();
  }, []);

  if (!data.ready) return <div className="app muted">読み込み中…</div>;

  if (!data.settings?.onboarded || !data.latest) {
    const needA2HS = !isStandalone() && !skipA2HS;
    return (
      <div className="app">
        <h1>初期設定</h1>
        {needA2HS ? (
          <div className="card">
            <p>iPhoneでは、<b>Safariのタブ</b>と<b>ホーム画面のアプリ</b>でデータの保存領域が別になります。</p>
            <p><b>ホーム画面に追加してから初期設定を行ってください。</b>(共有ボタン →「ホーム画面に追加」)</p>
            <button className="sub" style={{ width: '100%' }} onClick={() => setSkipA2HS(true)}>このまま続ける(PC・動作確認用)</button>
          </div>
        ) : (
          <ProfileGoalForm initial={data.settings ?? defaultSettings()} currentWeight={data.latest?.weightKg ?? null} submitLabel="はじめる"
            onSubmit={async ({ settings, weightKg }) => { await saveSettings(settings, weightKg, data.latest?.weightKg ?? null); }} />
        )}
      </div>
    );
  }

  return (
    <div className="app">
      {tab === 'home' && <HomeScreen data={data} go={setTab} />}
      {tab === 'meals' && <MealsScreen data={data} />}
      {tab === 'body' && <BodyScreen data={data} />}
      {tab === 'graph' && <GraphScreen data={data} />}
      {tab === 'settings' && <SettingsScreen data={data} persisted={persisted} />}
      <nav>{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
    </div>
  );
}
