import { beforeEach, describe, expect, it } from 'vitest';
import { AiError } from './gemini';
import { clearTask, getTask, retryTask, startTask } from './aiTask';

const o = { kind: 'meal_text' as const, label: 'l', doneLabel: 'd', tab: 'meals' as const };
const tick = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => clearTask());

describe('AI処理の再試行', () => {
  it('503などの一時的な失敗は、同じ処理で再試行でき、成功すると完了になる', async () => {
    let calls = 0;
    const seen: string[] = [];
    startTask(o, async () => { calls++; seen.push('同じ入力'); if (calls === 1) throw new AiError('http', 'overloaded (503)'); return { ok: 1 }; });
    await tick();
    expect(getTask()).toMatchObject({ phase: 'error', retryable: true });
    expect(retryTask()).toBe(true);
    expect(getTask()?.phase).toBe('running');
    await tick();
    expect(getTask()).toMatchObject({ phase: 'done', result: { ok: 1 } });
    expect(calls).toBe(2);
    expect(getTask()?.run).toBeUndefined(); // 完了後は入力(写真・文章)の参照を残さない
  });
  it('上限・停止・429は再試行できない', async () => {
    for (const k of ['quota', 'limit', 'stopped', 'disabled'] as const) {
      clearTask();
      startTask(o, async () => { throw new AiError(k, 'x'); });
      await tick();
      expect(getTask()?.retryable).toBe(false);
      expect(retryTask()).toBe(false);
    }
  });
  it('実行中は新しい処理を始められない(1件のみ)', () => {
    expect(startTask(o, () => new Promise(() => {}))).toBe(true);
    expect(startTask(o, async () => 1)).toBe(false);
  });
});
