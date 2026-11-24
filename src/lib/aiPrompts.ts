import type { Source, MealItem } from '../types';
import type { AppDb } from '../db';
import { callGemini } from './gemini';
import { LABEL_SCHEMA, SHEET_SCHEMA, parseLabelResponse, parseSheetResponse } from './sheet';
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

export async function analyzeSheet(db: AppDb, image: { mimeType: string; data: string }) {
  const json = await callGemini(db, {
    system: `あなたは体組成計の結果シートの写真から数値を読み取るアシスタントです。
- シートに書かれている「項目名と数値」のペアを、すべて raw_items に、書かれたとおり(項目名・値と単位)抽出する。
- 既知の項目(体重、体脂肪率、体脂肪量、筋肉量、骨格筋量、除脂肪体重、内臓脂肪レベル、体水分量、BMI、基礎代謝)は、対応する項目に数値だけを入れる。
- シートに載っていない項目・読み取れない数値は必ず null にする。推測や計算で埋めてはいけない。
- 測定日時が読み取れれば measured_at に YYYY-MM-DDTHH:mm で入れ、読み取れなければ null。
- 氏名・会員番号などの個人情報は出力しない。`,
    text: 'この体組成シートの写真を読み取ってください。', image, schema: SHEET_SCHEMA,
  });
  return parseSheetResponse(json);
}

export async function analyzeLabel(db: AppDb, image: { mimeType: string; data: string }) {
  const json = await callGemini(db, {
    system: `あなたは食品パッケージの栄養成分表示を読み取るアシスタントです。
- 表示されている数値だけを返す。「100gあたり」表示なら serving_amount=100、serving_unit="g" として、その値を返す。
- 食塩相当量の記載があれば salt_g に入れる。
- 表示にない項目・読み取れない項目は null にする。推測で埋めてはいけない。`,
    text: 'この栄養成分表示を読み取ってください。', image, schema: LABEL_SCHEMA,
  });
  return parseLabelResponse(json);
}
