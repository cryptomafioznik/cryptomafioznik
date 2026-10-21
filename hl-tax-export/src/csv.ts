// Minimal RFC 4180 CSV writer.
export function toCsv(columns: string[], rows: ReadonlyArray<object>): string {
  const esc = (v: unknown): string => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(esc).join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc((r as Record<string, unknown>)[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}
