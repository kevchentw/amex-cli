export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printText(lines: string[]): void {
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function colorize(text: string, color: AnsiColor): string {
  if (!supportsColor()) {
    return text;
  }

  return `${color}${text}${ANSI_RESET}`;
}

export function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== "dumb";
}

const ANSI_RESET = "\u001b[0m";

type AnsiColor =
  | "\u001b[1m"
  | "\u001b[2m"
  | "\u001b[34m"
  | "\u001b[32m"
  | "\u001b[33m"
  | "\u001b[36m"
  | "\u001b[90m";
