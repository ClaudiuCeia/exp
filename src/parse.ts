import type { Expr } from "./ast.ts";

export type ParseOptions = Readonly<{
  /** When true, throw on parse failure. Default: true */
  throwOnError?: boolean;
}>;

export type ParseError = Readonly<{
  message: string;
  index: number;
}>;

export type ParseResult =
  | Readonly<{ success: true; value: Expr }>
  | Readonly<{ success: false; error: ParseError }>;

/**
 * Parse a single expression.
 *
 * Placeholder implementation (MVP to unblock scaffolding).
 */
export function parseExpression(
  input: string,
  opts: ParseOptions = {},
): ParseResult {
  const throwOnError = opts.throwOnError ?? true;

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    const error = { message: "expected expression", index: 0 };
    if (throwOnError) throw new Error(error.message);
    return { success: false, error };
  }

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && String(asNumber) === trimmed) {
    return {
      success: true,
      value: {
        kind: "number",
        value: asNumber,
        span: {
          start: input.indexOf(trimmed),
          end: input.indexOf(trimmed) + trimmed.length,
        },
      },
    };
  }

  // naive quoted string only
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unquoted = trimmed.slice(1, -1);
    const start = input.indexOf(trimmed);
    return {
      success: true,
      value: {
        kind: "string",
        value: unquoted,
        span: { start, end: start + trimmed.length },
      },
    };
  }

  const error = {
    message: "unsupported expression",
    index: input.indexOf(trimmed),
  };
  if (throwOnError) throw new Error(`${error.message} at ${error.index}`);
  return { success: false, error };
}
