/** Terminal formatting. Colour only when someone is actually watching. */

const enabled =
  process.stdout.isTTY === true &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb";

const ESC = String.fromCharCode(27);
const wrap = (code: string) => (text: string) =>
  enabled ? `${ESC}[${code}m${text}${ESC}[0m` : text;

export const bold = wrap("1");
export const dim = wrap("2");
export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const blue = wrap("34");
export const cyan = wrap("36");
export const grey = wrap("90");

export function statusMark(status: string): string {
  switch (status) {
    case "ok":
      return green("OK");
    case "warn":
      return yellow("WARN");
    case "fail":
      return red("FAIL");
    case "disabled":
      return grey("DISABLED");
    default:
      return status.toUpperCase();
  }
}

export function heading(text: string): string {
  return `\n${bold(text)}`;
}

/** Two-column layout that stays aligned regardless of colour codes. */
export function row(label: string, value: string, width = 20): string {
  return `  ${label.padEnd(width)} ${value}`;
}

export function table(rows: string[][], gap = 2): string {
  if (rows.length === 0) return "";
  const widths: number[] = [];
  for (const r of rows) {
    r.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows
    .map((r) =>
      r
        .map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!)))
        .join(" ".repeat(gap)),
    )
    .join("\n");
}

export function fail(message: string): never {
  process.stderr.write(`${red("error")} ${message}\n`);
  process.exit(1);
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}
