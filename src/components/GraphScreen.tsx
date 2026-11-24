import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from 'recharts';
import { dailyWeights, movingAverage7, weeklyCalorieAverages } from '../lib/calc';
import { diffDays, mmdd, toLocalDate } from '../lib/dates';
import type { AppData } from './useAppData';
import { f1 } from './ui';

const H = 200;

export function GraphScreen({ data }: { data: AppData }) {
  const { settings, latest, targets } = data;
  if (!settings || !latest || !targets) return null;
  const w = movingAverage7(dailyWeights(data.body)).map((d) => ({ date: mmdd(d.date), 体重: d.weightKg, '7日平均': d.ma7 }));
  const bf = data.body.filter((b) => b.bodyFatPercent != null).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    .map((b) => ({ date: mmdd(b.measuredAt), 体脂肪率: b.bodyFatPercent }));
  const mu = data.body.filter((b) => (b.skeletalMuscleKg ?? b.muscleKg) != null).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    .map((b) => ({ date: mmdd(b.measuredAt), 筋肉量: b.skeletalMuscleKg ?? b.muscleKg }));
  const weeks = weeklyCalorieAverages(data.meals).slice(-12).map((x) => ({
    week: mmdd(x.weekStart), 平均kcal: x.avgKcal, days: x.days, reference: x.reference,
  }));
  const g = settings.goal;
  const lastFat = [...data.body].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)).find((b) => b.bodyFatPercent != null);
  const daysLeft = diffDays(toLocalDate(), g.targetDate);

  return (
    <div>
      <h1>グラフ</h1>
      <div className="card">
        <h2>目標までの残り</h2>
        <div>体重: {f1(latest.weightKg)} → {g.targetWeightKg}kg(差 {f1(g.targetWeightKg - latest.weightKg)}kg)</div>
        <div>体脂肪率: {lastFat ? `${f1(lastFat.bodyFatPercent!)} → ${g.targetBodyFatPercent}%(差 ${f1(g.targetBodyFatPercent - lastFat.bodyFatPercent!)}pt)` : '記録なし'}</div>
        <div>残り日数: {daysLeft >= 0 ? `${daysLeft}日` : `期限を${-daysLeft}日超過`}</div>
      </div>
      <div className="card">
        <h2>体重の推移</h2>
        {w.length < 2 ? <p className="muted">2日分以上の記録で表示されます。</p> : (
          <ResponsiveContainer width="100%" height={H}><LineChart data={w}>
            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" fontSize={11} /><YAxis domain={['auto', 'auto']} fontSize={11} width={36} />
            <Tooltip /><Legend />
            <ReferenceLine y={g.targetWeightKg} stroke="#9ca3af" strokeDasharray="4 4" />
            <Line dataKey="体重" stroke="#93c5fd" dot />
            <Line dataKey="7日平均" stroke="#16a34a" strokeWidth={2} dot={false} />
          </LineChart></ResponsiveContainer>
        )}
      </div>
      <div className="card">
        <h2>体脂肪率</h2>
        {bf.length < 2 ? <p className="muted">体組成の記録が2件以上で表示されます。</p> : (
          <ResponsiveContainer width="100%" height={H}><LineChart data={bf}>
            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" fontSize={11} /><YAxis domain={['auto', 'auto']} fontSize={11} width={36} />
            <Tooltip /><Line dataKey="体脂肪率" stroke="#f59e0b" strokeWidth={2} />
          </LineChart></ResponsiveContainer>
        )}
      </div>
      <div className="card">
        <h2>筋肉量(骨格筋量があればそちら)</h2>
        {mu.length < 2 ? <p className="muted">体組成の記録が2件以上で表示されます。</p> : (
          <ResponsiveContainer width="100%" height={H}><LineChart data={mu}>
            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" fontSize={11} /><YAxis domain={['auto', 'auto']} fontSize={11} width={36} />
            <Tooltip /><Line dataKey="筋肉量" stroke="#7c3aed" strokeWidth={2} />
          </LineChart></ResponsiveContainer>
        )}
      </div>
      <div className="card">
        <h2>週ごとの平均摂取カロリー</h2>
        <p className="muted">食事が記録された日だけで平均(未記録日は含めません)。目標 {targets.calories}kcal</p>
        {weeks.length === 0 ? <p className="muted">食事記録がありません。</p> : (
          <>
            <ResponsiveContainer width="100%" height={H}><BarChart data={weeks}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="week" fontSize={11} /><YAxis fontSize={11} width={40} />
              <Tooltip /><ReferenceLine y={targets.calories} stroke="#dc2626" strokeDasharray="4 4" />
              <Bar dataKey="平均kcal" fill="#16a34a" />
            </BarChart></ResponsiveContainer>
            {[...weeks].reverse().map((x) => (
              <div className="item" key={x.week}>
                <span>{x.week}〜 {x.days}日分の平均{x.reference && <span className="muted">(参考値)</span>}</span>
                <span>{x.平均kcal}kcal({Math.round((x.平均kcal / targets.calories) * 100)}%)</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
