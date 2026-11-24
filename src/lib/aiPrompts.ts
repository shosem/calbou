import type { Source, MealItem } from '../types';
import type { AppDb } from '../db';
import { callGemini } from './gemini';
import { ITEMS_SCHEMA, OPERATIONS_SCHEMA, parseItemsResponse, parseOperationsResponse } from './aiParse';

const COMMON = `あなたは日本の食事の栄養を推定するアシスタントです。
- 食品ごとに、量(amount と unit)とその量あたりの栄養素を日本語で返す。
- 合計は計算しない(食品ごとの値だけ返す)。
- 食物繊維・塩分が推定できない場合は null。他の項目は数値で返す。
- 量の推定が不確かな場合は confidence を下げる(high / medium / low)。
- 推定の根拠や注意点は notes に短く書く。`;

export async function analyzePhoto(db: AppDb, image: { mimeType: string; data: string }, hint: string) {
  const json = await callGemini(db, {
    system: COMMON,
    text: `この食事の写真に写っている食品を、食品ごとに分けて推定してください。${hint.trim() ? `\n利用者の補足: ${hint.trim()}` : ''}`,
    image, schema: ITEMS_SCHEMA,
  });
  return parseItemsResponse(json, 'ai_photo');
}

export async function analyzeText(db: AppDb, text: string) {
  const json = await callGemini(db, {
    system: `${COMMON}
- 量が書かれていない食品は、一般的な1人前を仮定し、confidence を medium 以下にして、notes に「量は一般的な1人前と仮定」と書く。`,
    text: `次の食事内容を、食品ごとに分けて推定してください。\n${text.trim()}`,
    schema: ITEMS_SCHEMA,
  });
  return parseItemsResponse(json, 'ai_text');
}

/** 文章による修正: AIは「操作の指示」だけを返し、計算(scale)はプログラムが行う */
export async function requestCorrection(db: AppDb, items: MealItem[], instruction: string, source: Source) {
  const list = items.map((it, i) => ({ item_index: i, name: it.name, amount: it.amount, unit: it.unit, calories_kcal: it.caloriesKcal }));
  const json = await callGemini(db, {
    system: `あなたは食事記録の修正指示を「操作のリスト」に変換するアシスタントです。数値の計算はしません。
- scale: 既存食品の量を factor 倍にする(例:「半分」→0.5)。item_index に対象の添字、factor に倍率。
- remove: 既存食品を削除する(item_index)。
- replace: 既存食品を別の食品に置き換える(item_index と item)。
- add: 食品を追加する(item)。栄養素はあなたが推定した値を入れる。
- 使わない項目は null にする。解釈できない指示は operations を空にして notes に理由を書く。
- 追加・置換する食品の栄養素は、その量あたりの値を数値で返す(食物繊維・塩分が不明なら null)。`,
    text: `現在の食品一覧(添字付き):\n${JSON.stringify(list)}\n\n利用者の指示: ${instruction.trim()}`,
    schema: OPERATIONS_SCHEMA,
  });
  return parseOperationsResponse(json, items.length, source);
}
