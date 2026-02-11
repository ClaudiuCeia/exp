import type { Span } from "./ast/mod.ts";

export type FormatCaretOptions = Readonly<{
  /** Max characters to include before the index. Default: 40 */
  before?: number;
  /** Max characters to include after the index. Default: 40 */
  after?: number;
}>;

export type FormatReportOptions = Readonly<{
  /** Include N lines before/after the error line. Default: 0 */
  contextLines?: number;
  /** Expand tabs to this many spaces. Default: 2 */
  tabWidth?: number;
}>;

const expandTabs = (s: string, tabWidth: number): string => {
  if (tabWidth <= 0) return s;
  return s.replaceAll("\t", " ".repeat(tabWidth));
};

const clampIndex = (input: string, index: number): number => {
  return Math.max(0, Math.min(input.length, index));
};

const splitLines = (input: string): string[] => {
  return input.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
};

const findLineInfo = (
  input: string,
  index: number,
): {
  line: number; // 1-based
  column: number; // 1-based
  lineIndex: number; // 0-based
  lineStart: number;
} => {
  const i = clampIndex(input, index);
  const lineStart = input.lastIndexOf("\n", i - 1) + 1;
  const lineIndex = input.slice(0, lineStart).split("\n").length - 1;
  const column = i - lineStart + 1;
  return { line: lineIndex + 1, column, lineIndex, lineStart };
};

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

  const i = clampIndex(input, index);

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
  if (typeof diag.index === "number") {
    return formatCaret(input, diag.index, opts);
  }
  if (diag.span) return formatSpanCaret(input, diag.span, opts);
  return formatCaret(input, 0, opts);
};

export type FormatDiagnosticReportSource = Readonly<{
  index?: number;
  span?: Span;
  message: string;
}>;

/**
 * Format a diagnostic in an Elm/OCaml-inspired style:
 *
 * ```
 *  1 | 1 +
 *    |   ╰─▶ expected expression at 1:4
 * ```
 */
export const formatDiagnosticReport = (
  input: string,
  diag: FormatDiagnosticReportSource,
  opts: FormatReportOptions = {},
): string => {
  const contextLines = opts.contextLines ?? 0;
  const tabWidth = opts.tabWidth ?? 2;

  const index = typeof diag.index === "number"
    ? diag.index
    : (diag.span ? diag.span.start : 0);

  const lines = splitLines(input);
  const info = findLineInfo(input, index);

  const startLineIdx = Math.max(0, info.lineIndex - contextLines);
  const endLineIdx = Math.min(lines.length - 1, info.lineIndex + contextLines);
  const lineNoWidth = String(endLineIdx + 1).length;

  const out: string[] = [];
  for (let i = startLineIdx; i <= endLineIdx; i++) {
    const lineNo = String(i + 1).padStart(lineNoWidth, " ");
    const printed = expandTabs(lines[i] ?? "", tabWidth);
    out.push(`${lineNo} | ${printed}`);

    if (i === info.lineIndex) {
      const rawLine = lines[i] ?? "";
      const gutter = " ".repeat(lineNoWidth);

      const span = diag.span;
      const hasSpan = span && span.end > span.start;
      if (hasSpan) {
        const startInfo = findLineInfo(input, span.start);
        const endInfo = findLineInfo(input, Math.max(span.start, span.end - 1));

        // Only render multi-span underline when the span stays on this line.
        if (
          startInfo.lineIndex === info.lineIndex &&
          endInfo.lineIndex === info.lineIndex
        ) {
          const rawPrefixStart = rawLine.slice(
            0,
            Math.max(0, startInfo.column - 1),
          );
          const rawPrefixEnd = rawLine.slice(
            0,
            Math.max(0, endInfo.column - 1),
          );
          const startPos = expandTabs(rawPrefixStart, tabWidth).length;
          const endPos = expandTabs(rawPrefixEnd, tabWidth).length;

          const lo = Math.min(startPos, endPos);
          const hi = Math.max(startPos, endPos);
          const width = Math.max(1, hi - lo + 1);

          const underline = `${gutter} | ${" ".repeat(lo)}╰${
            "─".repeat(Math.max(0, width - 2))
          }╯`;

          // Arrow originates from the center of the underline.
          const center = lo + Math.floor(width / 2);
          const arrow = `${gutter} | ${" ".repeat(center)}╰─▶ ${diag.message}`;

          out.push(underline);
          out.push(arrow);
          continue;
        }
      }

      // Fallback: point at a single column (index).
      const rawPrefix = rawLine.slice(0, Math.max(0, info.column - 1));
      const caretPos = expandTabs(rawPrefix, tabWidth).length;
      const arrow = `${gutter} | ${" ".repeat(caretPos)}╰─▶ ${diag.message}`;
      out.push(arrow);
    }
  }

  return out.join("\n");
};
