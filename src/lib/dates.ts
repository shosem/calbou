const p = (n: number) => String(n).padStart(2, '0');

export function toLocalDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function toLocalDateTime(d: Date = new Date()): string {
  return `${toLocalDate(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toLocalDate(d);
}
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}
/** 月曜始まりの週の開始日 */
export function weekStart(s: string): string {
  const d = parseDate(s);
  const dow = (d.getDay() + 6) % 7;
  return addDays(s, -dow);
}
export function mmdd(s: string): string {
  return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
}
