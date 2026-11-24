import Dexie, { type Table } from 'dexie';
import type {
  AdjustmentProposal, AiUsage, AppSettings, BodyComposition, MealEntry, MyFood, SheetLabelMapping,
} from './types';

export class AppDb extends Dexie {
  settings!: Table<AppSettings, string>;
  meals!: Table<MealEntry, string>;
  myFoods!: Table<MyFood, string>;
  body!: Table<BodyComposition, string>;
  proposals!: Table<AdjustmentProposal, string>;
  aiUsage!: Table<AiUsage, string>;
  sheetMappings!: Table<SheetLabelMapping, string>;

  constructor(name = 'calbou') {
    super(name);
    // 画像は一切保存しない(Blob/画像データ用のテーブルは存在しない)
    this.version(1).stores({
      settings: 'id',
      meals: 'id, date, category',
      myFoods: 'id, name',
      body: 'id, measuredAt',
      proposals: 'id, createdAt, status',
      aiUsage: 'date',
      sheetMappings: 'label',
    });
  }
}

export const db = new AppDb();
export const newId = () => crypto.randomUUID();
