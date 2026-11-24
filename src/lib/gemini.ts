import type { AppDb } from '../db';
import { markStopped, reserveCall } from './aiGuard';
import { toLocalDate } from './dates';

/** 使用モデル名(1か所で管理)。設定画面の上書き値が優先される。未設定なら "__SET_ME__" にしてAIを無効化する */
export const GEMINI_MODEL = 'gemini-3.8-flash';
const UNSET = '__SET_ME__';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// APIキー・モデル上書き・同意は localStorage にのみ保存(バックアップ対象外)
const K_KEY = 'calbou.ai.key';
const K_MODEL = 'calbou.ai.model';
const K_CONSENT = 'calbou.ai.consent';

export const aiStore = {
  getKey: () => localStorage.getItem(K_KEY) ?? '',
  setKey: (v: string) => (v ? localStorage.setItem(K_KEY, v) : localStorage.removeItem(K_KEY)),
  getModelOverride: () => localStorage.getItem(K_MODEL) ?? '',
  setModelOverride: (v: string) => (v ? localStorage.setItem(K_MODEL, v) : localStorage.removeItem(K_MODEL)),
  hasConsent: () => localStorage.getItem(K_CONSENT) === '1',
  setConsent: (v: boolean) => (v ? localStorage.setItem(K_CONSENT, '1') : localStorage.removeItem(K_CONSENT)),
};
export const effectiveModel = () => aiStore.getModelOverride().trim() || GEMINI_MODEL;

export type AiErrorKind = 'disabled' | 'limit' | 'stopped' | 'quota' | 'network' | 'http' | 'blocked' | 'bad_response';
export class AiError extends Error {
  constructor(public kind: AiErrorKind, message: string) { super(message); }
}

export type Unavailable = 'no_key' | 'no_model' | 'no_consent';
export function aiUnavailableReason(): Unavailable | null {
  if (!aiStore.getKey().trim()) return 'no_key';
  if (effectiveModel() === UNSET) return 'no_model';
  if (!aiStore.hasConsent()) return 'no_consent';
  return null;
}

export const FALLBACK_HINT = '手入力・マイ食品・履歴コピーで記録を続けられます。';

export interface GeminiRequest {
  system: string;
  text: string;
  image?: { mimeType: string; data: string }; // メモリ上のbase64のみ。保存しない
  schema: object;
}

/**
 * すべてのAI呼び出し(写真・文章・文章修正・シート・成分表示)はこの1関数を通り、必ず1回として数える。
 * 429は自動リトライせず、その日は停止扱いにする。
 */
export async function callGemini(
  db: AppDb, req: GeminiRequest,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<unknown> {
  const why = aiUnavailableReason();
  if (why) throw new AiError('disabled', 'AI機能が無効です(APIキー・モデル名・同意を確認してください)。');
  const date = toLocalDate(opts.now);
  const g = await reserveCall(db, date);
  if (!g.ok) {
    throw new AiError(g.reason, g.reason === 'limit'
      ? `本日の上限に達しました。${FALLBACK_HINT}` : `本日はAI解析を停止中です。${FALLBACK_HINT}`);
  }

  const parts: unknown[] = [{ text: req.text }];
  if (req.image) parts.push({ inlineData: { mimeType: req.image.mimeType, data: req.image.data } });
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: req.schema,
      thinkingConfig: { thinkingLevel: 'LOW' }, // gemini-3.8-flash は minimal 非対応
    },
  };

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${ENDPOINT}/${encodeURIComponent(effectiveModel())}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': aiStore.getKey().trim() }, // キーはURLに載せない
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new AiError('network', `通信に失敗しました。${FALLBACK_HINT}`);
  }

  if (res.status === 429) {
    await markStopped(db, date);
    throw new AiError('quota', `無料枠の上限に達しました。本日のAI解析は停止します。${FALLBACK_HINT}`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message ?? ''; } catch { /* ignore */ }
    throw new AiError('http', `AIの呼び出しに失敗しました(${res.status})${detail ? `: ${detail}` : ''}`);
  }

  let json: any;
  try { json = await res.json(); } catch { throw new AiError('bad_response', 'AIの応答を読み取れませんでした。'); }
  if (json?.promptFeedback?.blockReason) throw new AiError('blocked', 'AIが内容を処理できませんでした(安全性の制限)。');
  const text = (json?.candidates?.[0]?.content?.parts as { text?: string; thought?: boolean }[] | undefined)
    ?.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  if (!text) throw new AiError('bad_response', 'AIの応答が空でした。もう一度試すか、手入力してください。');
  try { return JSON.parse(text); } catch { throw new AiError('bad_response', 'AIの応答がJSONではありませんでした。'); }
}
