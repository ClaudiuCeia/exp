import type { Span } from "./ast/mod.ts";

export type FormatCaretOptions = Readonly<{
  /** Max characters to include before the index. Default: 40 */
  before?: number;
  /** Max characters to include after the index. Default: 40 */
  after?: number;
}>;

/**
 * Format a single-line snippet around `index` with a caret.
 *
 * Notes:
 * - `index` is clamped to `[0, input.length]`.
 * - The snippet is restricted to the line containing `index`.
 */
export const formatCaret = (
  input: string,
  index: number,
  opts: FormatCaretOptions = {},
): string => {
  const before = opts.before ?? 40;
  const after = opts.after ?? 40;

  const i = Math.max(0, Math.min(input.length, index));

  const lineStart = input.lastIndexOf("\n", i - 1) + 1;
  const lineEnd = (() => {
    const j = input.indexOf("\n", i);
    return j === -1 ? input.length : j;
  })();

  const start = Math.max(lineStart, i - before);
  const end = Math.min(lineEnd, i + after);

  const snippet = input.slice(start, end);
  const caretPos = i - start;
  return `${snippet}\n${" ".repeat(caretPos)}^`;
};

export const formatSpanCaret = (
  input: string,
  span: Span,
  opts: FormatCaretOptions = {},
): string => {
  return formatCaret(input, span.start, opts);
};

export type FormatDiagnosticCaretSource = Readonly<{
  index?: number;
  span?: Span;
}>;

/**
 * Convenience helper that prefers `index` (parse errors) and falls back to
 * `span.start` (eval errors).
 */
export const formatDiagnosticCaret = (
  input: string,
  diag: FormatDiagnosticCaretSource,
  opts: FormatCaretOptions = {},
): string => {
  if (typeof diag.index === "number") return formatCaret(input, diag.index, opts);
  if (diag.span) return formatSpanCaret(input, diag.span, opts);
  return formatCaret(input, 0, opts);
};
