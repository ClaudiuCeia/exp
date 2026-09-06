/**
 * Parse and evaluate application-defined filters, conditions, and formulas.
 *
 * Expressions are parsed into a typed AST and interpreted against an explicit
 * environment.
 *
 * @module
 */
export type { BinaryOp, Expr, NodeBase, Span, UnaryOp } from "./src/ast/mod.ts";
export {
  formatCaret,
  type FormatCaretOptions,
  formatDiagnosticCaret,
  type FormatDiagnosticCaretSource,
  formatDiagnosticReport,
  type FormatDiagnosticReportSource,
  type FormatReportOptions,
  formatSpanCaret,
} from "./src/diagnostics.ts";
export {
  ExpParseError,
  type ParseError,
  parseExpression,
  type ParseOptions,
  type ParseResult,
} from "./src/parse.ts";
export {
  type EvalError,
  type EvalOptions,
  type EvalResult,
  evaluateAst,
  evaluateExpression,
  type EvaluateExpressionOptions,
  ExpEvalError,
} from "./src/eval.ts";
export type {
  RuntimeArray,
  RuntimeFunction,
  RuntimeObject,
  RuntimePrimitive,
  RuntimeValue,
} from "./src/runtime.ts";

export { std } from "./src/std.ts";
