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
