import { useMemo, useState } from 'react';
import type { AppSettings, JobActivity, Mode } from '../types';
import { MODE_LABEL, PROTEIN_COEF_MAX, PROTEIN_COEF_MIN, checkFeasibility, suggestActivityFactor } from '../lib/calc';
import { NumField, f1 } from './ui';

export interface FormResult { settings: AppSettings; weightKg: number }

/** 初期設定と設定画面で共通のフォーム */
export function ProfileGoalForm({ initial, currentWeight, submitLabel, onSubmit }: {
  initial: AppSettings; currentWeight: number | null; submitLabel: string; onSubmit: (r: FormResult) => void;
}) {
  const [s, setS] = useState<AppSettings>(initial);
  const [weight, setWeight] = useState<number>(currentWeight ?? 70);
  const [factorTouched, setFactorTouched] = useState(initial.onboarded);
  const set = (patch: Partial<AppSettings>) => setS((p) => ({ ...p, ...patch }));
  const setProfile = (patch: Partial<AppSettings['profile']>) => setS((p) => ({ ...p, profile: { ...p.profile, ...patch } }));
  const setGoal = (patch: Partial<AppSettings['goal']>) => setS((p) => ({ ...p, goal: { ...p.goal, ...patch } }));

  const suggested = suggestActivityFactor(s.jobActivity, s.trainingPerWeek);
  const feas = useMemo(() => checkFeasibility(weight, s.goal), [weight, s.goal]);
  const updateActivity = (job: JobActivity, freq: number) => {
    set({ jobActivity: job, trainingPerWeek: freq });
    if (!factorTouched) setProfile({ activityFactor: suggestActivityFactor(job, freq) });
  };
  const valid = s.profile.age > 0 && s.profile.heightCm > 0 && weight > 0 && s.goal.targetWeightKg > 0
    && s.profile.activityFactor > 0 && s.goal.startDate && s.goal.targetDate;

  return (
    <div>
      <div className="card">
        <h2>プロフィール</h2>
        <label>性別</label>
        <select value={s.profile.sex} onChange={(e) => setProfile({ sex: e.target.value as 'male' | 'female' })}>
          <option value="male">男</option><option value="female">女</option>
        </select>
        <div className="grid3">
          <NumField label="年齢" value={s.profile.age} onChange={(v) => setProfile({ age: v ?? 0 })} />
          <NumField label="身長(cm)" value={s.profile.heightCm} onChange={(v) => setProfile({ heightCm: v ?? 0 })} />
          <NumField label="体重(kg)" value={weight} onChange={(v) => setWeight(v ?? 0)} />
        </div>
        <label>仕事の活動量</label>
        <select value={s.jobActivity} onChange={(e) => updateActivity(e.target.value as JobActivity, s.trainingPerWeek)}>
          <option value="desk">デスクワーク中心</option><option value="standing">立ち仕事</option><option value="active">よく動く</option>
        </select>
        <NumField label="トレーニング頻度(週回数)" value={s.trainingPerWeek} step="1" onChange={(v) => updateActivity(s.jobActivity, v ?? 0)} />
        <NumField label={`活動量係数(提案: ${suggested})`} value={s.profile.activityFactor}
          onChange={(v) => { setFactorTouched(true); setProfile({ activityFactor: v ?? 0 }); }} />
        {factorTouched && s.profile.activityFactor !== suggested && (
          <button className="sub small" onClick={() => { setFactorTouched(false); setProfile({ activityFactor: suggested }); }}>提案値に戻す</button>
        )}
      </div>

      <div className="card">
        <h2>目標</h2>
        <div className="grid2">
          <NumField label="目標体重(kg)" value={s.goal.targetWeightKg} onChange={(v) => setGoal({ targetWeightKg: v ?? 0 })} />
          <NumField label="目標体脂肪率(%)" value={s.goal.targetBodyFatPercent} onChange={(v) => setGoal({ targetBodyFatPercent: v ?? 0 })} />
        </div>
        <div className="grid2">
          <div><label>開始日</label><input type="date" value={s.goal.startDate} onChange={(e) => setGoal({ startDate: e.target.value })} /></div>
          <div><label>目標日</label><input type="date" value={s.goal.targetDate} onChange={(e) => setGoal({ targetDate: e.target.value })} /></div>
        </div>
        <label>モード</label>
        <select value={s.goal.mode} onChange={(e) => setGoal({ mode: e.target.value as Mode })}>
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </select>
        {feas && (
          <p className={feas.warn ? 'warn' : 'muted'}>
            必要ペース: {feas.ratePctPerWeek >= 0 ? '+' : ''}{f1(feas.ratePctPerWeek)}%/週
            {feas.warn && '(体重の±0.5%/週を大きく超えています。期間や目標の見直しを検討してください。保存は可能です)'}
          </p>
        )}
        {!feas && <p className="warn">開始日より後の目標日を設定してください。</p>}
        <NumField label={`たんぱく質係数(g/kg、${PROTEIN_COEF_MIN}〜${PROTEIN_COEF_MAX})`} value={s.proteinCoef}
          onChange={(v) => set({ proteinCoef: Math.min(PROTEIN_COEF_MAX, Math.max(PROTEIN_COEF_MIN, v ?? 2.2)) })} />
      </div>

      <button style={{ width: '100%' }} disabled={!valid} onClick={() => onSubmit({ settings: s, weightKg: weight })}>{submitLabel}</button>
    </div>
  );
}
