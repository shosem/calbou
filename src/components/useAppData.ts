import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { calcTargets, latestBody, latestBodyFat } from '../lib/calc';

export function useAppData() {
  const settings = useLiveQuery(() => db.settings.get('main'), []);
  const body = useLiveQuery(() => db.body.toArray(), []);
  const meals = useLiveQuery(() => db.meals.toArray(), []);
  const myFoods = useLiveQuery(() => db.myFoods.toArray(), []);
  const ready = settings !== undefined && body && meals && myFoods;
  const latest = body ? latestBody(body) : undefined;
  const bf = body ? latestBodyFat(body) : null;
  const targets = settings && latest ? calcTargets(settings.profile, settings.goal, latest.weightKg, bf, settings.proteinCoef) : null;
  return { ready: !!ready, settings, body: body ?? [], meals: meals ?? [], myFoods: myFoods ?? [], latest, latestBf: bf, targets };
}
export type AppData = ReturnType<typeof useAppData>;
