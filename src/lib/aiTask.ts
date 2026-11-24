import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AiError } from './gemini';

/**
 * AI処理(1件のみ)の状態をアプリ全体で持つ。画面を切り替えても処理は裏で続き、
 * 結果はメモリ上にだけ置く(写真や結果を保存しない)。
 */
export type TaskKind = 'meal_photo' | 'meal_text' | 'sheet' | 'label' | 'correction';
export type TaskTab = 'meals' | 'body';

export interface Task {
  id: number;
  kind: TaskKind;
  label: string;      // 実行中の表示
  doneLabel: string;  // 完了時の表示
  tab: TaskTab;       // 結果を確認する画面
  phase: 'running' | 'done' | 'error';
  result?: unknown;
  error?: string;
  ctx?: unknown;
  openRequested: boolean;
}

let task: Task | null = null;
let seq = 0;
let activeTab = 'home';
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const getTask = () => task;
/** 現在表示中のタブ(自動で結果を受け取るのは、その画面を見ているときだけにするため) */
export function setActiveTab(t: string) { if (t !== activeTab) { activeTab = t; emit(); } }
const getActiveTab = () => activeTab;
export const useTask = () => useSyncExternalStore(subscribe, getTask);

/** 実行中・未確認の処理があれば開始できない(同時に1件のみ)。開始できたら true */
export function startTask(
  o: { kind: TaskKind; label: string; doneLabel: string; tab: TaskTab; ctx?: unknown },
  run: () => Promise<unknown>,
): boolean {
  if (task) return false;
  const id = ++seq;
  task = { id, ...o, phase: 'running', openRequested: false };
  emit();
  run().then(
    (result) => { if (task?.id === id) { task = { ...task, phase: 'done', result }; emit(); } },
    (e) => {
      if (task?.id === id) {
        task = { ...task, phase: 'error', error: e instanceof AiError ? e.message : 'AIの処理で予期しないエラーが発生しました。手入力に切り替えてください。' };
        emit();
      }
    },
  );
  return true;
}

export function requestOpen() { if (task?.phase === 'done') { task = { ...task, openRequested: true }; emit(); } }
/** 結果の破棄、または実行中の処理の取り消し(取り消してもAPI呼び出しの1回分は消費済み) */
export function clearTask() { task = null; emit(); }

/**
 * 結果を受け取る側の画面で使う。完了済みで、種類が合い、かつ「開く」要求があった(または auto)ときに
 * handler を1度だけ呼び、処理を片付ける。
 */
export function useConsume(kinds: TaskKind[], handler: (t: Task) => void, opts: { auto?: boolean } = {}) {
  const t = useTask();
  const at = useSyncExternalStore(subscribe, getActiveTab);
  const h = useRef(handler); h.current = handler;
  useEffect(() => {
    const cur = getTask(); // StrictModeの再実行で二重に呼ばないよう、最新値を読む
    if (cur && cur.phase === 'done' && kinds.includes(cur.kind) && (cur.openRequested || (opts.auto && getActiveTab() === cur.tab))) {
      clearTask();
      h.current(cur);
    }
  }, [t, at]); // eslint-disable-line react-hooks/exhaustive-deps
}
