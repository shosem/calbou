import { useState } from 'react';

/** 数値入力。空欄は null として扱う */
export function NumField({ label, value, onChange, step = 'any', nullable = false }: {
  label: string; value: number | null; onChange: (v: number | null) => void; step?: string; nullable?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div>
      <label>{label}</label>
      <input
        type="number" inputMode="decimal" step={step}
        value={text ?? (value == null ? '' : String(value))}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.value === '' ? null : Number(e.target.value);
          if (n == null) { if (nullable) onChange(null); else onChange(0); } else if (!Number.isNaN(n)) onChange(n);
        }}
        onBlur={() => setText(null)}
      />
    </div>
  );
}

export function Bar({ value, max, over }: { value: number; max: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div className={`bar ${over ? 'over' : ''}`}><i style={{ width: `${pct}%` }} /></div>;
}

export const f1 = (n: number) => String(Math.round(n * 10) / 10);
