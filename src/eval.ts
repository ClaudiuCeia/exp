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
  /** Parse error index when evaluation fails due to parse failure. */
  index?: number;
}>;

export class ExpEvalError extends Error {
  readonly span?: Span;
  readonly steps?: number;
  readonly index?: number;

  constructor(error: EvalError) {
    super(error.message);
    this.name = "ExpEvalError";
    this.span = error.span;
    this.steps = error.steps;
    this.index = error.index;
  }
}

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

const normalizeEnv = (
  env: unknown,
): { ok: true; env: Record<string, RuntimeValue> } | {
  ok: false;
  message: string;
} => {
  if (env === undefined) return { ok: true, env: {} };
  if (!isPlainObject(env)) {
    return {
      ok: false,
      message: "env must be a plain object (or proto-null object)",
    };
  }

  for (const [k, v] of Object.entries(env)) {
    if (!isRuntimeValue(v)) {
      return {
        ok: false,
        message: `env['${k}'] is not a supported runtime value`,
      };
    }
  }

  return { ok: true, env: env as Record<string, RuntimeValue> };
};

const isTruthy = (v: RuntimeValue): boolean => {
  return !!v;
};

const isPrimitive = (v: RuntimeValue): v is RuntimePrimitive => {
  return v === undefined || v === null || typeof v !== "object";
};

// JS-style loose equality, but with a crucial safety rule:
// never coerce non-primitives (objects/arrays/functions) via ToPrimitive.
// This avoids implicit method lookups/calls like `obj.toString()`.
const looseEqualSafe = (a: RuntimeValue, b: RuntimeValue): boolean => {
  // Fast path for identical values and identical references.
  if (a === b) return true;

  // If either side is a non-primitive (object/array/function), do not coerce.
  // For objects, JS loose equality ends up as reference equality anyway, unless
  // compared against a primitive (where ToPrimitive would kick in). We
  // intentionally return false in those coercing cases.
  if (!isPrimitive(a) || !isPrimitive(b)) return false;

  // Nullish equality: `null == undefined`.
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  // Booleans coerce to numbers.
  if (typeof a === "boolean") return looseEqualSafe(toNumber(a), b);
  if (typeof b === "boolean") return looseEqualSafe(a, toNumber(b));

  // String/number cross-coercion.
  if (typeof a === "string" && typeof b === "number") {
    return Number(a) == b;
  }
  if (typeof a === "number" && typeof b === "string") {
    return a == Number(b);
  }

  // Remaining primitive pairs: strict equality is enough.
  return a === b;
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
    if (!Object.hasOwn(obj, prop)) return undefined;
    return (obj as Record<string, RuntimeValue>)[prop];
  }

  return undefined;
};

const evalExpr = (expr: Expr, ctx: Ctx): EvalResult => {
  const budget = bump(ctx, expr.span);
  if (budget) return budget;

  if (ctx.depth > ctx.maxDepth) {
    return evalError(
      "evaluation recursion limit exceeded",
      expr.span,
      ctx.steps,
    );
  }

  ctx.depth++;
  try {
    switch (expr.kind) {
      case "number":
      case "string":
      case "boolean":
        return { success: true, value: expr.value };
      case "null":
        return { success: true, value: null };
      case "identifier":
        return {
          success: true,
          value: Object.hasOwn(ctx.env, expr.name)
            ? ctx.env[expr.name]
            : undefined,
        };
      case "array": {
        if (expr.elements.length > ctx.maxArrayElements) {
          return evalError("array literal too large", expr.span, ctx.steps);
        }
        const out: RuntimeValue[] = [];
        for (const el of expr.elements) {
          const r = evalExpr(el, ctx);
          if (!r.success) return r;
          out.push(r.value);
        }
        return { success: true, value: out };
      }
      case "unary": {
        const span = expr.span;
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
            return { success: true, value: looseEqualSafe(a, b) };
          case "!=":
            return { success: true, value: !looseEqualSafe(a, b) };
        }

        return evalError("unknown binary operator", span, ctx.steps);
      }
      case "member": {
        const obj = evalExpr(expr.object, ctx);
        if (!obj.success) return obj;
        const value = getMember(obj.value, expr.property);
        return { success: true, value };
      }
      case "call": {
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
      }
      case "conditional": {
        const test = evalExpr(expr.test, ctx);
        if (!test.success) return test;
        return isTruthy(test.value)
          ? evalExpr(expr.consequent, ctx)
          : evalExpr(expr.alternate, ctx);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return evalError(msg, expr.span, ctx.steps);
  } finally {
    ctx.depth--;
  }
};

export function evaluateAst(expr: Expr, opts: EvalOptions = {}): EvalResult {
  const throwOnError = opts.throwOnError ?? true;

  const envRes = normalizeEnv(opts.env as unknown);
  if (!envRes.ok) {
    const e: EvalError = { message: envRes.message, steps: 0 };
    if (throwOnError) throw new ExpEvalError(e);
    return { success: false, error: e };
  }

  const ctx: Ctx = {
    env: envRes.env,
    steps: 0,
    maxSteps: opts.maxSteps ?? 10_000,
    depth: 0,
    maxDepth: opts.maxDepth ?? 256,
    maxArrayElements: opts.maxArrayElements ?? 1_000,
  };

  const res = evalExpr(expr, ctx);
  if (res.success) return res;
  if (throwOnError) throw new ExpEvalError(res.error);
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
        index: parsed.error.index,
      },
    };
  }
  return evaluateAst(parsed.value, opts);
}
