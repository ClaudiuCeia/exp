export type { Expr, NodeBase, Span } from "./src/ast/mod.ts";
export { parseExpression } from "./src/parse.ts";
export {
  type EvalError,
  type EvalOptions,
  type EvalResult,
  evaluateAst,
  evaluateExpression,
  type EvaluateExpressionOptions,
  type RuntimeValue,
} from "./src/eval.ts";
