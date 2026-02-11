export type { Expr, NodeBase, Span } from "./src/ast/mod.ts";
export {
  type FormatCaretOptions,
  type FormatReportOptions,
  type FormatDiagnosticCaretSource,
  type FormatDiagnosticReportSource,
  formatCaret,
  formatDiagnosticCaret,
  formatDiagnosticReport,
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
  type RuntimeValue,
} from "./src/eval.ts";
