import type { Expr, Span } from "./ast/mod.ts";
import { describeThrownValue } from "./error.ts";
import { parseExpression } from "./parse.ts";

import {
  isPlainObject,
  isRuntimeValue,
  normalizeEnv,
  type RuntimePrimitive,
  type RuntimeValue,
} from "./runtime.ts";

import { std } from "./std.ts";

const WeakSetConstructor = WeakSet;
const weakSetHas = WeakSet.prototype.has;
const weakSetAdd = WeakSet.prototype.add;
const reflectApply = Reflect.apply;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectEntries = Object.entries;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;

const createContainerSet = (): WeakSet<object> =>
  new WeakSetConstructor<object>();

const containerSetHas = (set: WeakSet<object>, container: object): boolean =>
  reflectApply(weakSetHas, set, [container]);

const containerSetAdd = (set: WeakSet<object>, container: object): void => {
  reflectApply(weakSetAdd, set, [container]);
};

/**
 * A candidate environment supplied for runtime validation and normalization.
 *
 * The top level must be a plain or null-prototype object at runtime. Its values
 * are checked recursively before evaluation, so type acceptance alone does not
 * guarantee that an input is supported.
 */
export type EnvironmentInput = object;

/** Options for `evaluateAst` and `evaluateExpression`. */
export type EvalOptions = Readonly<{
  /**
   * Identifier bindings available to the expression.
   *
   * Identifiers resolve as `env[name]`.
   *
   * The input is validated and normalized before each evaluation.
   */
  env?: EnvironmentInput | undefined;

  /**
   * Max AST traversal work during validation and, separately, max nodes visited
   * during evaluation. Validation charges the root and every AST edge.
   * Default: 10_000.
   */
  maxSteps?: number;
  /** Max AST depth during validation and evaluation. Default: 256 */
  maxDepth?: number;
  /** Max elements allowed in an array literal. Default: 1_000 */
  maxArrayElements?: number;
  /** Max arguments allowed in one call expression. Default: 1_000 */
  maxCallArguments?: number;
  /** Max nesting in environment and function-return values. Default: 64 */
  maxRuntimeDepth?: number;
  /** Max entries in environment and function-return values. Default: 10_000 */
  maxRuntimeEntries?: number;

  /**
   * Behavior when an identifier is not present on `env`.
   *
   * - `"error"`: fail evaluation with a typed error (default)
   * - `"undefined"`: treat missing identifiers as `undefined` (legacy JS-ish)
   */
  unknownIdentifier?: "error" | "undefined";

  /** When true, throw on evaluation failure. Default: true */
  throwOnError?: boolean;
}>;

/**
 * An evaluation failure.
 *
 * - `span` is present for errors tied to a specific AST node.
 * - `index` is present when evaluation failed because parsing failed.
 */
export type EvalError = Readonly<{
  message: string;
  span?: Span;
  /** Validation work or evaluation node visits completed at failure. */
  steps?: number;
  /** Parse error index when evaluation fails due to parse failure. */
  index?: number;
}>;

/**
 * Thrown evaluation error (default mode).
 *
 * Carries either `span` (eval failures) and/or `index` (parse failures).
 */
export class ExpEvalError extends Error {
  /** AST span for eval errors tied to a node. */
  readonly span?: Span;
  /** Step counter at the time of failure (useful with budgets). */
  readonly steps?: number;
  /** UTF-16 code-unit index when the failure originated from parsing. */
  readonly index?: number;

  /** Create an `ExpEvalError` from an `EvalError` payload. */
  constructor(error: EvalError) {
    super(error.message);
    this.name = "ExpEvalError";
    this.span = error.span;
    this.steps = error.steps;
    this.index = error.index;
  }
}

/** Result returned by `evaluateAst` / `evaluateExpression` in non-throwing mode. */
export type EvalResult =
  | Readonly<{ success: true; value: RuntimeValue }>
  | Readonly<{ success: false; error: EvalError }>;

type Ctx = {
  env: Record<string, RuntimeValue>;
  currentContainers: WeakSet<object>;
  steps: number;
  maxSteps: number;
  depth: number;
  maxDepth: number;
  maxArrayElements: number;
  maxCallArguments: number;
  maxRuntimeDepth: number;
  maxRuntimeEntries: number;
  unknownIdentifier: "error" | "undefined";
};

const FORBIDDEN_MEMBERS = new Set(["__proto__", "prototype", "constructor"]);
const DEFAULT_MAX_ARRAY_ELEMENTS = 1_000;
const DEFAULT_MAX_CALL_ARGUMENTS = DEFAULT_MAX_ARRAY_ELEMENTS;
const UNSUPPORTED_MEMBER_ERROR = "member is not a supported runtime value";

const isRuntimeArray = (value: RuntimeValue): value is RuntimeValue[] => {
  try {
    return Array.isArray(value);
  } catch {
    throw new Error(UNSUPPORTED_MEMBER_ERROR);
  }
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

const readEvaluationLimit = (
  value: number | undefined,
  fallback: number,
  name: string,
): number | string => {
  const limit = value ?? fallback;
  return Number.isSafeInteger(limit) && limit >= 0
    ? limit
    : `${name} must be a non-negative safe integer`;
};

const bump = (ctx: Ctx, span?: Span): EvalResult | null => {
  ctx.steps++;
  if (ctx.steps > ctx.maxSteps) {
    return evalError("evaluation budget exceeded", span, ctx.steps);
  }
  return null;
};

const getMember = (obj: RuntimeValue, prop: string, ctx: Ctx): RuntimeValue => {
  if (FORBIDDEN_MEMBERS.has(prop)) {
    throw new Error("forbidden member access");
  }

  const ownerIsContainer = obj !== null && typeof obj === "object";
  const ownerWasCurrent =
    ownerIsContainer && containerSetHas(ctx.currentContainers, obj);
  if (ownerIsContainer && !ownerWasCurrent) {
    ctx.currentContainers = createContainerSet();
  }

  if (isRuntimeArray(obj)) {
    if (prop !== "length") return undefined;
    if (!ownerWasCurrent) {
      if (
        !isRuntimeValue(obj, {
          maxDepth: ctx.maxRuntimeDepth,
          maxEntries: ctx.maxRuntimeEntries,
        })
      ) {
        throw new Error(UNSUPPORTED_MEMBER_ERROR);
      }
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = objectGetOwnPropertyDescriptor(obj, "length");
    } catch {
      throw new Error(UNSUPPORTED_MEMBER_ERROR);
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(UNSUPPORTED_MEMBER_ERROR);
    }
    const length: unknown = descriptor.value;
    if (
      typeof length !== "number" ||
      !numberIsSafeInteger(length) ||
      length < 0 ||
      (!ownerWasCurrent && length > ctx.maxRuntimeEntries)
    ) {
      throw new Error(UNSUPPORTED_MEMBER_ERROR);
    }
    return length;
  }

  if (isPlainObject(obj)) {
    const descriptor = objectGetOwnPropertyDescriptor(obj, prop);
    if (descriptor === undefined || !descriptor.enumerable) return undefined;
    if (!("value" in descriptor)) {
      throw new Error("member must be an enumerable data property");
    }
    const value: unknown = descriptor.value;
    const isContainer = value !== null && typeof value === "object";
    if (ownerWasCurrent) {
      if (isContainer) containerSetAdd(ctx.currentContainers, value);
    } else {
      if (
        !isRuntimeValue(value, {
          maxDepth: ctx.maxRuntimeDepth,
          maxEntries: ctx.maxRuntimeEntries,
        })
      ) {
        throw new Error(UNSUPPORTED_MEMBER_ERROR);
      }
    }
    return value as RuntimeValue;
  }

  return undefined;
};

type CallExpr = Extract<Expr, { kind: "call" }>;

type IdentifierExpr = Extract<Expr, { kind: "identifier" }>;
type ArrayExpr = Extract<Expr, { kind: "array" }>;
type UnaryExpr = Extract<Expr, { kind: "unary" }>;
type BinaryExpr = Extract<Expr, { kind: "binary" }>;
type MemberExpr = Extract<Expr, { kind: "member" }>;
type ConditionalExpr = Extract<Expr, { kind: "conditional" }>;
type UndefinedExpr = Extract<Expr, { kind: "undefined" }>;

const evalIdentifierExpr = (expr: IdentifierExpr, ctx: Ctx): EvalResult => {
  if (objectHasOwn(ctx.env, expr.name)) {
    return { success: true, value: ctx.env[expr.name] };
  }
  if (ctx.unknownIdentifier === "undefined") {
    return { success: true, value: undefined };
  }
  return evalError(`unknown identifier '${expr.name}'`, expr.span, ctx.steps);
};

const evalArrayExpr = (expr: ArrayExpr, ctx: Ctx): EvalResult => {
  if (expr.elements.length > ctx.maxArrayElements) {
    return evalError("array literal too large", expr.span, ctx.steps);
  }

  const out: RuntimeValue[] = [];
  for (const el of expr.elements) {
    const r = evalExpr(el, ctx);
    if (!r.success) return r;
    out.push(r.value);
  }
  containerSetAdd(ctx.currentContainers, out);
  return { success: true, value: out };
};

const evalUndefinedExpr = (_expr: UndefinedExpr, _ctx: Ctx): EvalResult => {
  return { success: true, value: undefined };
};

const evalUnaryExpr = (expr: UnaryExpr, ctx: Ctx): EvalResult => {
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

  return evalError("unknown unary operator", expr.span, ctx.steps);
};

const evalBinaryExpr = (expr: BinaryExpr, ctx: Ctx): EvalResult => {
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

  if (expr.op === "??") {
    const l = evalExpr(expr.left, ctx);
    if (!l.success) return l;
    if (l.value !== null && l.value !== undefined) return l;
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
        value:
          typeof a === "string" || typeof b === "string"
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

  return evalError("unknown binary operator", expr.span, ctx.steps);
};

const evalMemberExpr = (expr: MemberExpr, ctx: Ctx): EvalResult => {
  const obj = evalExpr(expr.object, ctx);
  if (!obj.success) return obj;
  const value = getMember(obj.value, expr.property, ctx);
  return { success: true, value };
};

const evalCallExpr = (expr: CallExpr, ctx: Ctx): EvalResult => {
  if (expr.args.length > ctx.maxCallArguments) {
    return evalError("call argument list too large", expr.span, ctx.steps);
  }

  let fn: RuntimeValue;
  let receiver: RuntimeValue | undefined;

  if (expr.callee.kind === "member") {
    const obj = evalExpr(expr.callee.object, ctx);
    if (!obj.success) return obj;
    receiver = obj.value;
    fn = getMember(obj.value, expr.callee.property, ctx);
  } else {
    const callee = evalExpr(expr.callee, ctx);
    if (!callee.success) return callee;
    fn = callee.value;
  }

  if (typeof fn !== "function") {
    return evalError("attempted to call a non-function", expr.span, ctx.steps);
  }

  const args: RuntimeValue[] = [];
  for (const a of expr.args) {
    const ar = evalExpr(a, ctx);
    if (!ar.success) return ar;
    args.push(ar.value);
  }

  ctx.currentContainers = createContainerSet();
  const out = receiver === undefined ? fn(...args) : fn.apply(receiver, args);
  if (
    !isRuntimeValue(out, {
      maxDepth: ctx.maxRuntimeDepth,
      maxEntries: ctx.maxRuntimeEntries,
    })
  ) {
    return evalError(
      "function returned an unsupported value",
      expr.span,
      ctx.steps,
    );
  }
  return { success: true, value: out };
};

const evalConditionalExpr = (expr: ConditionalExpr, ctx: Ctx): EvalResult => {
  const test = evalExpr(expr.test, ctx);
  if (!test.success) return test;
  return isTruthy(test.value)
    ? evalExpr(expr.consequent, ctx)
    : evalExpr(expr.alternate, ctx);
};

const evalExpr = (expr: Expr, ctx: Ctx): EvalResult => {
  let span: Span | undefined;
  try {
    span = expr.span;
    const budget = bump(ctx, span);
    if (budget) return budget;

    if (ctx.depth > ctx.maxDepth) {
      return evalError("evaluation recursion limit exceeded", span, ctx.steps);
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
        case "undefined":
          return evalUndefinedExpr(expr, ctx);
        case "identifier":
          return evalIdentifierExpr(expr, ctx);
        case "array":
          return evalArrayExpr(expr, ctx);
        case "unary":
          return evalUnaryExpr(expr, ctx);
        case "binary":
          return evalBinaryExpr(expr, ctx);
        case "member":
          return evalMemberExpr(expr, ctx);
        case "call":
          return evalCallExpr(expr, ctx);
        case "conditional":
          return evalConditionalExpr(expr, ctx);
      }
      return evalError("unknown expression kind", span, ctx.steps);
    } finally {
      ctx.depth--;
    }
  } catch (error) {
    return evalError(describeThrownValue(error), span, ctx.steps);
  }
};

type AstValidationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; message: string }>;

const astValidationError = (message: string): AstValidationResult => ({
  ok: false,
  message: `invalid AST: ${message}`,
});

const readAstProperty = (
  value: object,
  property: string,
): { ok: true; value: unknown } | { ok: false; message: string } => {
  const descriptor = objectGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !("value" in descriptor)) {
    return { ok: false, message: `'${property}' must be an own data property` };
  }
  return { ok: true, value: descriptor.value };
};

const validateSpan = (value: unknown): AstValidationResult => {
  if (value === null || typeof value !== "object") {
    return astValidationError("span must be an object");
  }
  const start = readAstProperty(value, "start");
  if (!start.ok) return astValidationError(start.message);
  const end = readAstProperty(value, "end");
  if (!end.ok) return astValidationError(end.message);
  if (
    !Number.isSafeInteger(start.value) ||
    !Number.isSafeInteger(end.value) ||
    (start.value as number) < 0 ||
    (end.value as number) < (start.value as number)
  ) {
    return astValidationError(
      "span must contain ordered non-negative integers",
    );
  }
  return { ok: true };
};

const readAstChildren = (
  value: object,
  property: string,
  maxLength: number,
  tooLargeMessage: string,
):
  | { ok: true; value: unknown[]; length: number }
  | { ok: false; message: string } => {
  const field = readAstProperty(value, property);
  if (!field.ok) return field;
  if (!Array.isArray(field.value)) {
    return { ok: false, message: `'${property}' must be an Array` };
  }

  const lengthDescriptor = objectGetOwnPropertyDescriptor(
    field.value,
    "length",
  );
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
    return {
      ok: false,
      message: `'${property}.length' must be an own data property`,
    };
  }
  const length = lengthDescriptor.value;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    return {
      ok: false,
      message: `'${property}.length' must be a non-negative safe integer`,
    };
  }
  if (length > maxLength) return { ok: false, message: tooLargeMessage };

  return { ok: true, value: field.value, length };
};

const validateAst = (
  root: unknown,
  maxWork: number,
  maxDepth: number,
  maxArrayElements: number,
  maxCallArguments: number,
): AstValidationResult & Readonly<{ steps: number }> => {
  type Frame =
    | Readonly<{
        type: "node";
        value: unknown;
        depth: number;
        charged: boolean;
      }>
    | Readonly<{ type: "exit"; value: object }>
    | Readonly<{
        type: "property";
        value: object;
        property: string;
        depth: number;
      }>
    | Readonly<{
        type: "children";
        value: unknown[];
        property: string;
        index: number;
        length: number;
        depth: number;
      }>;
  const pending: Frame[] = [
    { type: "node", value: root, depth: 0, charged: false },
  ];
  const states = new WeakMap<object, "active" | "done">();
  let steps = 0;

  const chargeTraversal = (): AstValidationResult | null => {
    steps++;
    return steps > maxWork
      ? astValidationError("validation budget exceeded")
      : null;
  };

  const run = (): AstValidationResult => {
    try {
      while (pending.length > 0) {
        const frame = pending.pop();
        if (frame === undefined) break;

        if (frame.type === "exit") {
          states.set(frame.value, "done");
          continue;
        }

        if (frame.type === "property") {
          const budget = chargeTraversal();
          if (budget !== null) return budget;
          const child = readAstProperty(frame.value, frame.property);
          if (!child.ok) return astValidationError(child.message);
          pending.push({
            type: "node",
            value: child.value,
            depth: frame.depth,
            charged: true,
          });
          continue;
        }

        if (frame.type === "children") {
          if (frame.index >= frame.length) continue;
          const budget = chargeTraversal();
          if (budget !== null) return budget;
          const child = objectGetOwnPropertyDescriptor(
            frame.value,
            String(frame.index),
          );
          if (child === undefined || !("value" in child)) {
            return astValidationError(
              `'${frame.property}[${frame.index}]' must be an own data property`,
            );
          }
          pending.push({ ...frame, index: frame.index + 1 });
          pending.push({
            type: "node",
            value: child.value,
            depth: frame.depth,
            charged: true,
          });
          continue;
        }

        if (!frame.charged) {
          const budget = chargeTraversal();
          if (budget !== null) return budget;
        }
        if (frame.value === null || typeof frame.value !== "object") {
          return astValidationError("expression node must be an object");
        }

        const node = frame.value;
        if (frame.depth > maxDepth) {
          return astValidationError("recursion limit exceeded");
        }
        const state = states.get(node);
        if (state === "active") return astValidationError("cycle detected");
        if (state === "done") continue;

        states.set(node, "active");
        pending.push({ type: "exit", value: node });

        const span = readAstProperty(node, "span");
        if (!span.ok) return astValidationError(span.message);
        const spanResult = validateSpan(span.value);
        if (!spanResult.ok) return spanResult;

        const kind = readAstProperty(node, "kind");
        if (!kind.ok) return astValidationError(kind.message);
        if (typeof kind.value !== "string") {
          return astValidationError("'kind' must be a string");
        }

        const queueChild = (property: string): void => {
          pending.push({
            type: "property",
            value: node,
            property,
            depth: frame.depth + 1,
          });
        };
        const queueChildren = (
          children: Readonly<{
            value: unknown[];
            length: number;
          }>,
          property: string,
        ): void => {
          if (children.length === 0) return;
          pending.push({
            type: "children",
            value: children.value,
            property,
            index: 0,
            length: children.length,
            depth: frame.depth + 1,
          });
        };
        const requireType = (
          property: string,
          type: "boolean" | "number" | "string",
        ): AstValidationResult => {
          const field = readAstProperty(node, property);
          if (!field.ok) return astValidationError(field.message);
          const matches =
            type === "boolean"
              ? typeof field.value === "boolean"
              : type === "number"
                ? typeof field.value === "number"
                : typeof field.value === "string";
          if (!matches) {
            return astValidationError(`'${property}' must be a ${type}`);
          }
          return { ok: true };
        };

        let result: AstValidationResult = { ok: true };
        switch (kind.value) {
          case "number":
            result = requireType("value", "number");
            break;
          case "string":
            result = requireType("value", "string");
            break;
          case "boolean":
            result = requireType("value", "boolean");
            break;
          case "null":
          case "undefined":
            break;
          case "identifier":
            result = requireType("name", "string");
            break;
          case "array": {
            const elements = readAstChildren(
              node,
              "elements",
              maxArrayElements,
              "array literal too large",
            );
            if (!elements.ok) return astValidationError(elements.message);
            queueChildren(elements, "elements");
            break;
          }
          case "unary":
            result = requireType("op", "string");
            if (result.ok) queueChild("expr");
            break;
          case "binary":
            result = requireType("op", "string");
            if (result.ok) queueChild("right");
            if (result.ok) queueChild("left");
            break;
          case "member":
            result = requireType("property", "string");
            if (result.ok) queueChild("object");
            break;
          case "call": {
            const args = readAstChildren(
              node,
              "args",
              maxCallArguments,
              "call argument list too large",
            );
            if (!args.ok) return astValidationError(args.message);
            queueChild("callee");
            queueChildren(args, "args");
            break;
          }
          case "conditional":
            queueChild("alternate");
            queueChild("consequent");
            queueChild("test");
            break;
          default:
            return astValidationError("unknown expression kind");
        }
        if (!result.ok) return result;
      }
    } catch {
      return astValidationError("inspection failed");
    }

    return { ok: true };
  };

  return { ...run(), steps };
};

/**
 * Defensively validate and evaluate a pre-parsed AST.
 *
 * Validation does not copy AST child arrays. It applies `maxArrayElements` and
 * `maxCallArguments` before reading entries, then charges `maxSteps` for the
 * root and every traversed edge. Evaluation starts a separate `maxSteps`
 * counter.
 */
export function evaluateAst(expr: Expr, opts: EvalOptions = {}): EvalResult {
  const throwOnError = opts.throwOnError ?? true;
  const limitValues = [
    readEvaluationLimit(opts.maxSteps, 10_000, "maxSteps"),
    readEvaluationLimit(opts.maxDepth, 256, "maxDepth"),
    readEvaluationLimit(
      opts.maxArrayElements,
      DEFAULT_MAX_ARRAY_ELEMENTS,
      "maxArrayElements",
    ),
    readEvaluationLimit(
      opts.maxCallArguments,
      DEFAULT_MAX_CALL_ARGUMENTS,
      "maxCallArguments",
    ),
    readEvaluationLimit(opts.maxRuntimeDepth, 64, "maxRuntimeDepth"),
    readEvaluationLimit(opts.maxRuntimeEntries, 10_000, "maxRuntimeEntries"),
  ] as const;
  const limitError = limitValues.find(
    (value): value is string => typeof value === "string",
  );
  if (limitError !== undefined) {
    const error: EvalError = { message: limitError, steps: 0 };
    if (throwOnError) throw new ExpEvalError(error);
    return { success: false, error };
  }
  const [
    maxSteps,
    maxDepth,
    maxArrayElements,
    maxCallArguments,
    maxRuntimeDepth,
    maxRuntimeEntries,
  ] = limitValues as readonly number[];

  const astResult = validateAst(
    expr as unknown,
    maxSteps,
    maxDepth,
    maxArrayElements,
    maxCallArguments,
  );
  if (!astResult.ok) {
    const error: EvalError = {
      message: astResult.message,
      steps: astResult.steps,
    };
    if (throwOnError) throw new ExpEvalError(error);
    return { success: false, error };
  }

  const currentContainers = createContainerSet();
  const envRes = normalizeEnv(opts.env as unknown, {
    maxDepth: maxRuntimeDepth,
    maxEntries: maxRuntimeEntries,
  });
  if (!envRes.ok) {
    const e: EvalError = { message: envRes.message, steps: 0 };
    if (throwOnError) throw new ExpEvalError(e);
    return { success: false, error: e };
  }

  let res: EvalResult;
  try {
    if (objectHasOwn(envRes.env, "std")) {
      res = evalError(
        "env['std'] is reserved (stdlib is always available as std.*)",
        undefined,
        0,
      );
    } else {
      const env = objectCreate(null) as Record<string, RuntimeValue>;
      objectDefineProperty(env, "std", {
        value: std,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      containerSetAdd(currentContainers, std);
      const entries = objectEntries(envRes.env);
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry === undefined) {
          throw new Error("normalized environment entry is missing");
        }
        const k = entry[0];
        const v = entry[1];
        objectDefineProperty(env, k, {
          value: v,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        if (v !== null && typeof v === "object") {
          containerSetAdd(currentContainers, v);
        }
      }

      const ctx: Ctx = {
        env,
        currentContainers,
        steps: 0,
        maxSteps,
        depth: 0,
        maxDepth,
        maxArrayElements,
        maxCallArguments,
        maxRuntimeDepth,
        maxRuntimeEntries,
        unknownIdentifier: opts.unknownIdentifier ?? "error",
      };
      res = evalExpr(expr, ctx);
    }
  } catch {
    res = evalError("evaluation setup failed", undefined, 0);
  }

  if (res.success) return res;
  if (throwOnError) throw new ExpEvalError(res.error);
  return res;
}

/** Options for `evaluateExpression` (includes all `EvalOptions`). */
export type EvaluateExpressionOptions = EvalOptions &
  Readonly<{
    /** When true, throw on parse failure. Default: true */
    throwOnParseError?: boolean;
    /** Maximum parser input length in UTF-16 code units. Default: 100,000. */
    maxInputLength?: number;
    /** Maximum recursive parser syntax nesting. Default: 64. */
    maxNestingDepth?: number;
    /**
     * Maximum AST node allocations during parsing, including transient nodes.
     * Default: 10,000.
     */
    maxNodes?: number;
  }>;

/**
 * Parse + evaluate a single expression.
 *
 * If `throwOnParseError: false`, parse failures return an `EvalError` that
 * includes `index` so callers can render diagnostics.
 */
export function evaluateExpression(
  input: string,
  opts: EvaluateExpressionOptions = {},
): EvalResult {
  const parsed = parseExpression(input, {
    throwOnError: opts.throwOnParseError ?? true,
    maxInputLength: opts.maxInputLength,
    maxNestingDepth: opts.maxNestingDepth,
    maxNodes: opts.maxNodes,
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
