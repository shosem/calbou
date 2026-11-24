export interface Profile {
  sex: 'male' | 'female';
  age: number;
  heightCm: number;
  activityFactor: number; // 手動上書き可
}

export type Mode = 'recomp' | 'lean_bulk' | 'cut';

export interface Goal {
  targetWeightKg: number;
  targetBodyFatPercent: number;
  startDate: string; // YYYY-MM-DD
  targetDate: string;
  mode: Mode;
  calorieAdjustmentKcal: number; // 承認済み提案の累計補正
}

export type Category = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type Source = 'manual' | 'ai_photo' | 'ai_text' | 'my_food' | 'history' | 'ai_label';

export interface MealItem {
  name: string;
  amount: number;
  unit: string;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number | null;
  saltG: number | null;
  source: Source;
  confidence?: 'high' | 'medium' | 'low';
}

export interface MealEntry {
  id: string;
  date: string; // YYYY-MM-DD
  category: Category;
  items: MealItem[];
  memo?: string;
  createdAt: string;
}

export interface MyFood {
  id: string;
  name: string;
  category: 'food' | 'supplement';
  servingAmount: number;
  servingUnit: string;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number | null;
  saltG: number | null;
}

export interface BodyComposition {
  id: string;
  measuredAt: string; // YYYY-MM-DDTHH:mm
  source: 'quick' | 'manual' | 'ai_sheet';
  weightKg: number;
  bodyFatPercent: number | null;
  bodyFatKg: number | null;
  muscleKg: number | null;
  skeletalMuscleKg: number | null;
  leanBodyMassKg: number | null;
  visceralFatLevel: number | null;
  bodyWaterL: number | null;
  bmi: number | null;
  bmrKcal: number | null;
  memo?: string;
}

export interface AdjustmentProposal {
  id: string;
  createdAt: string;
  deltaKcal: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface AiUsage {
  date: string;
  count: number;
  stopped: boolean;
}

export interface SheetLabelMapping {
  label: string;
  field: keyof BodyComposition;
}

export type JobActivity = 'desk' | 'standing' | 'active';

/** 端末内に1件だけ保存する設定(APIキーは段階2以降で別管理し、バックアップに含めない) */
export interface AppSettings {
  id: 'main';
  profile: Profile;
  goal: Goal;
  jobActivity: JobActivity;
  trainingPerWeek: number;
  proteinCoef: number; // 1.6〜2.4
  onboarded: boolean;
  lastBackupAt: string | null;
}
