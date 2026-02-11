import type { Expr, Span } from "./ast/mod.ts";
import { parseExpression } from "./parse.ts";

export type RuntimePrimitive = undefined | null | boolean | number | string;

export type RuntimeFunction = (...args: RuntimeValue[]) => RuntimeValue;

export interface RuntimeArray extends Array<RuntimeValue> {}

export interface RuntimeObject {
  [key: string]: RuntimeValue;
}

export type RuntimeValue =
  | RuntimePrimitive
  | RuntimeArray
  | RuntimeObject
  | RuntimeFunction;

export type EvalOptions = Readonly<{
  /**
   * Identifier bindings available to the expression.
   *
   * Identifiers resolve as `env[name]`.
   *
   * Recommended shapes:
   * - primitives (`undefined | null | boolean | number | string`)
   * - arrays of supported values
   * - plain objects (`{...}`) of supported values
   * - functions that accept/return supported values
   */
  env?: Record<string, RuntimeValue>;

  /** Max AST nodes visited (rough compute budget). Default: 10_000 */
  maxSteps?: number;
  /** Max recursion depth while evaluating. Default: 256 */
  maxDepth?: number;
  /** Max elements allowed in an array literal. Default: 1_000 */
  maxArrayElements?: number;

  /** When true, throw on evaluation failure. Default: true */
  throwOnError?: boolean;
}>;

export type EvalError = Readonly<{
  message: string;
  span?: Span;
  steps?: number;
}>;

export type EvalResult =
  | Readonly<{ success: true; value: RuntimeValue }>
  | Readonly<{ success: false; error: EvalError }>;

type Ctx = {
  env: Record<string, RuntimeValue>;
  steps: number;
  maxSteps: number;
  depth: number;
  maxDepth: number;
  maxArrayElements: number;
};

const FORBIDDEN_MEMBERS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isRuntimeValue = (value: unknown): value is RuntimeValue => {
  if (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "function"
  ) {
    return true;
  }

  if (Array.isArray(value)) return value.every(isRuntimeValue);
  if (isPlainObject(value)) {
    return Object.values(value).every(isRuntimeValue);
  }

  return false;
};

const isTruthy = (v: RuntimeValue): boolean => {
  return !!v;
};

const toNumber = (v: RuntimeValue): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  if (v === undefined) return NaN;
  if (typeof v === "string") return Number(v);
  throw new Error("expected primitive");
};

const toString = (v: RuntimeValue): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  throw new Error("expected primitive");
};

const evalError = (
  message: string,
  span?: Span,
  steps?: number,
): EvalResult => ({ success: false, error: { message, span, steps } });

const bump = (ctx: Ctx, span?: Span): EvalResult | null => {
  ctx.steps++;
  if (ctx.steps > ctx.maxSteps) {
    return evalError("evaluation budget exceeded", span, ctx.steps);
  }
  if (ctx.depth > ctx.maxDepth) {
    return evalError("evaluation recursion limit exceeded", span, ctx.steps);
  }
  return null;
};

const getMember = (obj: RuntimeValue, prop: string): RuntimeValue => {
  if (FORBIDDEN_MEMBERS.has(prop)) {
    throw new Error("forbidden member access");
  }

  if (Array.isArray(obj)) {
    if (prop === "length") return obj.length;
    return undefined;
  }

  if (isPlainObject(obj)) {
    return (obj as Record<string, RuntimeValue>)[prop];
  }

  return undefined;
};

const evalExpr = (expr: Expr, ctx: Ctx): EvalResult => {
  const budget = bump(ctx, expr.span);
  if (budget) return budget;

  switch (expr.kind) {
    case "number":
    case "string":
    case "boolean":
      return { success: true, value: expr.value };
    case "null":
      return { success: true, value: null };
    case "identifier":
      return { success: true, value: ctx.env[expr.name] };
    case "array": {
      if (expr.elements.length > ctx.maxArrayElements) {
        return evalError("array literal too large", expr.span, ctx.steps);
      }
      const out: RuntimeValue[] = [];
      ctx.depth++;
      try {
        for (const el of expr.elements) {
          const r = evalExpr(el, ctx);
          if (!r.success) return r;
          out.push(r.value);
        }
      } finally {
        ctx.depth--;
      }
      return { success: true, value: out };
    }
    case "unary": {
      const span = expr.span;
      ctx.depth++;
      try {
        const r = evalExpr(expr.expr, ctx);
        if (!r.success) return r;
        const v = r.value;
        switch (expr.op) {
          case "!":
            return { success: true, value: !isTruthy(v) };
          case "+":
            return { success: true, value: toNumber(v) };
          case "-":
            return { success: true, value: -toNumber(v) };
        }

        return evalError("unknown unary operator", span, ctx.steps);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return evalError(msg, span, ctx.steps);
      } finally {
        ctx.depth--;
      }
    }
    case "binary": {
      const span = expr.span;
      // Short-circuiting operators must be lazy.
      if (expr.op === "&&") {
        const l = evalExpr(expr.left, ctx);
        if (!l.success) return l;
        if (!isTruthy(l.value)) return l;
        return evalExpr(expr.right, ctx);
      }
      if (expr.op === "||") {
        const l = evalExpr(expr.left, ctx);
        if (!l.success) return l;
        if (isTruthy(l.value)) return l;
        return evalExpr(expr.right, ctx);
      }

      ctx.depth++;
      try {
        const l = evalExpr(expr.left, ctx);
        if (!l.success) return l;
        const r = evalExpr(expr.right, ctx);
        if (!r.success) return r;

        const a = l.value;
        const b = r.value;

        switch (expr.op) {
          case "+":
            return {
              success: true,
              value: typeof a === "string" || typeof b === "string"
                ? toString(a) + toString(b)
                : toNumber(a) + toNumber(b),
            };
          case "-":
            return { success: true, value: toNumber(a) - toNumber(b) };
          case "*":
            return { success: true, value: toNumber(a) * toNumber(b) };
          case "/":
            return { success: true, value: toNumber(a) / toNumber(b) };
          case "%":
            return { success: true, value: toNumber(a) % toNumber(b) };
          case "<":
            return { success: true, value: toNumber(a) < toNumber(b) };
          case "<=":
            return { success: true, value: toNumber(a) <= toNumber(b) };
          case ">":
            return { success: true, value: toNumber(a) > toNumber(b) };
          case ">=":
            return { success: true, value: toNumber(a) >= toNumber(b) };
          case "==":
            return { success: true, value: a == b };
          case "!=":
            return { success: true, value: a != b };
        }

        return evalError("unknown binary operator", span, ctx.steps);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return evalError(msg, span, ctx.steps);
      } finally {
        ctx.depth--;
      }
    }
    case "member": {
      ctx.depth++;
      try {
        const obj = evalExpr(expr.object, ctx);
        if (!obj.success) return obj;
        const value = getMember(obj.value, expr.property);
        return { success: true, value };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return evalError(msg, expr.span, ctx.steps);
      } finally {
        ctx.depth--;
      }
    }
    case "call": {
      ctx.depth++;
      try {
        let fn: RuntimeValue;
        let receiver: RuntimeValue | undefined;

        if (expr.callee.kind === "member") {
          const obj = evalExpr(expr.callee.object, ctx);
          if (!obj.success) return obj;
          receiver = obj.value;
          fn = getMember(obj.value, expr.callee.property);
        } else {
          const callee = evalExpr(expr.callee, ctx);
          if (!callee.success) return callee;
          fn = callee.value;
        }

        if (typeof fn !== "function") {
          return evalError(
            "attempted to call a non-function",
            expr.span,
            ctx.steps,
          );
        }

        const args: RuntimeValue[] = [];
        for (const a of expr.args) {
          const ar = evalExpr(a, ctx);
          if (!ar.success) return ar;
          args.push(ar.value);
        }

        const out = receiver === undefined
          ? fn(...args)
          : fn.apply(receiver, args);
        if (!isRuntimeValue(out)) {
          return evalError(
            "function returned an unsupported value",
            expr.span,
            ctx.steps,
          );
        }
        return { success: true, value: out };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return evalError(msg, expr.span, ctx.steps);
      } finally {
        ctx.depth--;
      }
    }
    case "conditional": {
      const test = evalExpr(expr.test, ctx);
      if (!test.success) return test;
      return isTruthy(test.value)
        ? evalExpr(expr.consequent, ctx)
        : evalExpr(expr.alternate, ctx);
    }
  }
};

export function evaluateAst(expr: Expr, opts: EvalOptions = {}): EvalResult {
  const throwOnError = opts.throwOnError ?? true;
  const ctx: Ctx = {
    env: opts.env ?? {},
    steps: 0,
    maxSteps: opts.maxSteps ?? 10_000,
    depth: 0,
    maxDepth: opts.maxDepth ?? 256,
    maxArrayElements: opts.maxArrayElements ?? 1_000,
  };

  const res = evalExpr(expr, ctx);
  if (res.success) return res;
  if (throwOnError) throw new Error(res.error.message);
  return res;
}

export type EvaluateExpressionOptions =
  & EvalOptions
  & Readonly<{
    /** When true, throw on parse failure. Default: true */
    throwOnParseError?: boolean;
  }>;

/** Parse + evaluate a single expression. */
export function evaluateExpression(
  input: string,
  opts: EvaluateExpressionOptions = {},
): EvalResult {
  const parsed = parseExpression(input, {
    throwOnError: opts.throwOnParseError ?? true,
  });
  if (!parsed.success) {
    return {
      success: false,
      error: {
        message: parsed.error.message,
        steps: 0,
      },
    };
  }
  return evaluateAst(parsed.value, opts);
}
