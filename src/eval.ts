import { type Expr, isBinaryOp, isUnaryOp, type Span } from "./ast/mod.ts";
import { describeThrownValue } from "./error.ts";
import { parseExpression } from "./parse.ts";

import {
  checkRuntimeValue,
  isPlainObject,
  normalizeEnv,
  prepareEnv,
  type Env,
  type RuntimeFunction,
  type RuntimePrimitive,
  type RuntimeValue,
} from "./runtime.ts";

import { std } from "./std.ts";

const WeakSetConstructor = WeakSet;
const WeakMapConstructor = WeakMap;
const arrayIsArray = Array.isArray;
const weakSetHas = WeakSet.prototype.has;
const weakSetAdd = WeakSet.prototype.add;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const reflectApply = Reflect.apply;
const mathMax = Math.max;
const mathMin = Math.min;
const mathTrunc = Math.trunc;
const NumberConstructor = Number;
const negativeInfinity = Number.NEGATIVE_INFINITY;
const numberIsFinite = Number.isFinite;
const numberIsNaN = Number.isNaN;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectEntries = Object.entries;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const StringConstructor = String;
const stringCharCodeAt = String.prototype.charCodeAt;

const assertNever = (_value: never): never => {
  throw new Error("unexpected operator");
};

const createContainerSet = (): WeakSet<object> =>
  new WeakSetConstructor<object>();

const containerSetHas = (set: WeakSet<object>, container: object): boolean =>
  reflectApply(weakSetHas, set, [container]);

const containerSetAdd = (set: WeakSet<object>, container: object): void => {
  reflectApply(weakSetAdd, set, [container]);
};

declare const preparedEnvironmentBrand: unique symbol;

/**
 * An opaque, deeply frozen environment snapshot created by
 * `prepareEnvironment` for reuse within the same module instance.
 */
export type PreparedEnvironment = Readonly<{
  [preparedEnvironmentBrand]: "PreparedEnvironment";
}>;

type PreparedEnvironmentState = Readonly<{
  env: Env;
  containers: WeakSet<object>;
  maxDepth: number;
  entries: number;
}>;

const preparedEnvironmentPrototype = objectFreeze(objectCreate(null));
const preparedEnvironments = new WeakMapConstructor<
  object,
  PreparedEnvironmentState
>();

const getPreparedEnvironment = (
  value: object,
): PreparedEnvironmentState | undefined =>
  reflectApply(weakMapGet, preparedEnvironments, [value]);

const setPreparedEnvironment = (
  value: PreparedEnvironment,
  state: PreparedEnvironmentState,
): void => {
  reflectApply(weakMapSet, preparedEnvironments, [value, state]);
};

/**
 * A candidate environment supplied for runtime validation and normalization.
 *
 * The top level must be a plain or null-prototype object at runtime. Its values
 * are checked recursively before evaluation, so type acceptance alone does not
 * guarantee that an input is supported.
 */
export type EnvironmentInput = object;

/** Runtime graph limits used while preparing an environment. */
export type PrepareEnvironmentOptions = Readonly<{
  /** Max nesting in the environment. Default: 64 */
  maxRuntimeDepth?: number;
  /** Max entries in the environment. Default: 10,000 */
  maxRuntimeEntries?: number;
}>;

/** Options for `evaluateAst` and `evaluateExpression`. */
export type EvalOptions = Readonly<{
  /**
   * Identifier bindings available to the expression.
   *
   * Identifiers resolve as `env[name]`.
   *
   * Ordinary inputs are validated and normalized before each evaluation.
   * Prepared environments receive a constant-time runtime-limit check instead.
   */
  env?: EnvironmentInput | PreparedEnvironment | undefined;

  /**
   * Max work during AST validation and, separately, evaluation. Evaluation
   * charges AST visits, built-in coercion and string work, standard-library
   * operations, and runtime-value validation. Host-function execution is not
   * counted. Default: 10_000.
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
  /** Validation edges or evaluation work units charged at failure. */
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
  /** Work counter at the time of failure (useful with budgets). */
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
  immutableContainers: WeakSet<object>;
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
const DEFAULT_MAX_RUNTIME_DEPTH = 64;
const DEFAULT_MAX_RUNTIME_ENTRIES = 10_000;
const UNSUPPORTED_MEMBER_ERROR = "member is not a supported runtime value";

class EvaluationBudgetExceeded extends Error {
  constructor() {
    super("evaluation budget exceeded");
    this.name = "EvaluationBudgetExceeded";
  }
}

const reserveWork = (ctx: Ctx, units: number): boolean => {
  if (units > ctx.maxSteps - ctx.steps) {
    ctx.steps = ctx.maxSteps + 1;
    return false;
  }
  ctx.steps += units;
  return true;
};

const consumeWork = (ctx: Ctx, units: number): void => {
  if (!reserveWork(ctx, units)) throw new EvaluationBudgetExceeded();
};

const isRuntimeArray = (value: RuntimeValue): value is RuntimeValue[] => {
  try {
    return arrayIsArray(value);
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
const looseEqualSafe = (
  a: RuntimeValue,
  b: RuntimeValue,
  ctx: Ctx,
): boolean => {
  if (typeof a === "string" && typeof b === "string") {
    consumeWork(ctx, a.length === b.length ? a.length : 1);
    return a === b;
  }

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
  if (typeof a === "boolean") return looseEqualSafe(toNumber(a, ctx), b, ctx);
  if (typeof b === "boolean") return looseEqualSafe(a, toNumber(b, ctx), ctx);

  // String/number cross-coercion.
  if (typeof a === "string" && typeof b === "number") {
    return toNumber(a, ctx) == b;
  }
  if (typeof a === "number" && typeof b === "string") {
    return a == toNumber(b, ctx);
  }

  // Remaining primitive pairs: strict equality is enough.
  return a === b;
};

const toNumber = (v: RuntimeValue, ctx: Ctx): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  if (v === undefined) return NaN;
  if (typeof v === "string") {
    consumeWork(ctx, v.length);
    return NumberConstructor(v);
  }
  throw new Error("expected primitive");
};

const toString = (v: RuntimeValue): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number") return StringConstructor(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  throw new Error("expected primitive");
};

const evalError = (
  message: string,
  span?: Span,
  steps?: number,
): Extract<EvalResult, { success: false }> => ({
  success: false,
  error: { message, span, steps },
});

const readEvaluationLimit = (
  value: number | undefined,
  fallback: number,
  name: string,
): number | string => {
  const limit = value ?? fallback;
  return numberIsSafeInteger(limit) && limit >= 0
    ? limit
    : `${name} must be a non-negative safe integer`;
};

/**
 * Validate, normalize, and freeze an environment for repeated evaluation.
 *
 * The returned snapshot is opaque and can only be used by this module instance.
 * Invalid inputs and limits throw `ExpEvalError`.
 *
 * @throws {ExpEvalError} When the input or a runtime graph limit is invalid.
 */
export function prepareEnvironment(
  env: EnvironmentInput,
  opts: PrepareEnvironmentOptions = {},
): PreparedEnvironment {
  const maxDepth = readEvaluationLimit(
    opts.maxRuntimeDepth,
    DEFAULT_MAX_RUNTIME_DEPTH,
    "maxRuntimeDepth",
  );
  const maxEntries = readEvaluationLimit(
    opts.maxRuntimeEntries,
    DEFAULT_MAX_RUNTIME_ENTRIES,
    "maxRuntimeEntries",
  );
  if (typeof maxDepth === "string") {
    throw new ExpEvalError({ message: maxDepth, steps: 0 });
  }
  if (typeof maxEntries === "string") {
    throw new ExpEvalError({ message: maxEntries, steps: 0 });
  }

  const normalized = prepareEnv(env, {
    maxDepth,
    maxEntries,
  });
  if (!normalized.ok) {
    throw new ExpEvalError({ message: normalized.message, steps: 0 });
  }
  if (objectHasOwn(normalized.env, "std")) {
    throw new ExpEvalError({
      message: "env['std'] is reserved (stdlib is always available as std.*)",
      steps: 0,
    });
  }

  const preparedEnv = objectCreate(null) as Env;
  objectDefineProperty(preparedEnv, "std", {
    value: std,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  for (const [key, value] of objectEntries(normalized.env)) {
    objectDefineProperty(preparedEnv, key, {
      value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  objectFreeze(preparedEnv);
  containerSetAdd(normalized.containers, preparedEnv);
  containerSetAdd(normalized.containers, std);

  const prepared = objectFreeze(
    objectCreate(preparedEnvironmentPrototype),
  ) as PreparedEnvironment;
  setPreparedEnvironment(prepared, {
    env: preparedEnv,
    containers: normalized.containers,
    maxDepth: normalized.maxDepth,
    entries: normalized.entries,
  });
  return prepared;
}

const bump = (
  ctx: Ctx,
  span?: Span,
): Extract<EvalResult, { success: false }> | null => {
  return reserveWork(ctx, 1)
    ? null
    : evalError("evaluation budget exceeded", span, ctx.steps);
};

const supportsRuntimeValue = (
  value: unknown,
  ctx: Ctx,
): value is RuntimeValue => {
  const result = checkRuntimeValue(
    value,
    {
      maxDepth: ctx.maxRuntimeDepth,
      maxEntries: ctx.maxRuntimeEntries,
    },
    (units) => reserveWork(ctx, units),
  );
  if (!result.ok && result.reason === "budget") {
    throw new EvaluationBudgetExceeded();
  }
  return result.ok;
};

const getMember = (obj: RuntimeValue, prop: string, ctx: Ctx): RuntimeValue => {
  consumeWork(ctx, prop.length);
  if (FORBIDDEN_MEMBERS.has(prop)) {
    throw new Error("forbidden member access");
  }

  const ownerIsContainer = obj !== null && typeof obj === "object";
  const ownerWasCurrent =
    ownerIsContainer && containerSetHas(ctx.currentContainers, obj);
  const ownerIsImmutable =
    ownerIsContainer && containerSetHas(ctx.immutableContainers, obj);
  const ownerIsTrusted = ownerWasCurrent || ownerIsImmutable;
  if (ownerIsContainer && !ownerIsTrusted) {
    ctx.currentContainers = createContainerSet();
  }

  if (isRuntimeArray(obj)) {
    if (prop !== "length") return undefined;
    if (!ownerIsTrusted) {
      if (!supportsRuntimeValue(obj, ctx)) {
        throw new Error(UNSUPPORTED_MEMBER_ERROR);
      }
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = ownerIsImmutable
        ? objectGetOwnPropertyDescriptor(obj, "length")
        : Object.getOwnPropertyDescriptor(obj, "length");
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
      (!ownerIsTrusted && length > ctx.maxRuntimeEntries)
    ) {
      throw new Error(UNSUPPORTED_MEMBER_ERROR);
    }
    return length;
  }

  if (isPlainObject(obj)) {
    const descriptor = ownerIsImmutable
      ? objectGetOwnPropertyDescriptor(obj, prop)
      : Object.getOwnPropertyDescriptor(obj, prop);
    if (descriptor === undefined || !descriptor.enumerable) return undefined;
    if (!("value" in descriptor)) {
      throw new Error("member must be an enumerable data property");
    }
    const value: unknown = descriptor.value;
    const isContainer = value !== null && typeof value === "object";
    if (ownerIsImmutable) {
      if (isContainer && !containerSetHas(ctx.immutableContainers, value)) {
        throw new Error(UNSUPPORTED_MEMBER_ERROR);
      }
    } else if (ownerWasCurrent) {
      if (isContainer) containerSetAdd(ctx.currentContainers, value);
    } else {
      if (!supportsRuntimeValue(value, ctx)) {
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
  consumeWork(ctx, expr.name.length);
  if (Object.hasOwn(ctx.env, expr.name)) {
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
  const op: unknown = expr.op;
  if (!isUnaryOp(op)) {
    return evalError("unknown unary operator", expr.span, ctx.steps);
  }
  const r = evalExpr(expr.expr, ctx);
  if (!r.success) return r;
  const v = r.value;

  switch (op) {
    case "!":
      return { success: true, value: !isTruthy(v) };
    case "+":
      return { success: true, value: toNumber(v, ctx) };
    case "-":
      return { success: true, value: -toNumber(v, ctx) };
  }

  return assertNever(op);
};

const evalBinaryExpr = (expr: BinaryExpr, ctx: Ctx): EvalResult => {
  const op: unknown = expr.op;
  if (!isBinaryOp(op)) {
    return evalError("unknown binary operator", expr.span, ctx.steps);
  }
  // Short-circuiting operators must be lazy.
  if (op === "&&") {
    const l = evalExpr(expr.left, ctx);
    if (!l.success) return l;
    if (!isTruthy(l.value)) return l;
    return evalExpr(expr.right, ctx);
  }
  if (op === "||") {
    const l = evalExpr(expr.left, ctx);
    if (!l.success) return l;
    if (isTruthy(l.value)) return l;
    return evalExpr(expr.right, ctx);
  }

  if (op === "??") {
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

  switch (op) {
    case "+":
      if (typeof a === "string" || typeof b === "string") {
        const left = toString(a);
        const right = toString(b);
        consumeWork(ctx, left.length + right.length);
        return { success: true, value: left + right };
      }
      return {
        success: true,
        value: toNumber(a, ctx) + toNumber(b, ctx),
      };
    case "-":
      return { success: true, value: toNumber(a, ctx) - toNumber(b, ctx) };
    case "*":
      return { success: true, value: toNumber(a, ctx) * toNumber(b, ctx) };
    case "/":
      return { success: true, value: toNumber(a, ctx) / toNumber(b, ctx) };
    case "%":
      return { success: true, value: toNumber(a, ctx) % toNumber(b, ctx) };
    case "<":
      return { success: true, value: toNumber(a, ctx) < toNumber(b, ctx) };
    case "<=":
      return { success: true, value: toNumber(a, ctx) <= toNumber(b, ctx) };
    case ">":
      return { success: true, value: toNumber(a, ctx) > toNumber(b, ctx) };
    case ">=":
      return { success: true, value: toNumber(a, ctx) >= toNumber(b, ctx) };
    case "==":
      return { success: true, value: looseEqualSafe(a, b, ctx) };
    case "!=":
      return { success: true, value: !looseEqualSafe(a, b, ctx) };
  }

  return assertNever(op);
};

const evalMemberExpr = (expr: MemberExpr, ctx: Ctx): EvalResult => {
  const obj = evalExpr(expr.object, ctx);
  if (!obj.success) return obj;
  const value = getMember(obj.value, expr.property, ctx);
  return { success: true, value };
};

type MemberCallTarget =
  | Readonly<{
      success: true;
      receiver: RuntimeValue;
      value: RuntimeValue;
    }>
  | Readonly<{ success: false; error: EvalError }>;

const evalMemberCallTarget = (expr: MemberExpr, ctx: Ctx): MemberCallTarget => {
  let span: Span | undefined;
  try {
    span = expr.span;
    const budget = bump(ctx, span);
    if (budget !== null) return budget;
    if (ctx.depth > ctx.maxDepth) {
      return evalError("evaluation recursion limit exceeded", span, ctx.steps);
    }

    ctx.depth++;
    try {
      const receiver = evalExpr(expr.object, ctx);
      if (!receiver.success) return receiver;
      return {
        success: true,
        receiver: receiver.value,
        value: getMember(receiver.value, expr.property, ctx),
      };
    } finally {
      ctx.depth--;
    }
  } catch (error) {
    return evalError(describeThrownValue(error), span, ctx.steps);
  }
};

type StandardCallResult =
  | Readonly<{ handled: false }>
  | Readonly<{ handled: true; value: RuntimeValue }>;

const stringCodeUnit = (value: string, index: number): number =>
  reflectApply(stringCharCodeAt, value, [index]);

const includesString = (
  haystack: string,
  needle: string,
  ctx: Ctx,
): boolean => {
  if (needle.length === 0) return true;
  const lastStart = haystack.length - needle.length;
  for (let start = 0; start <= lastStart; start++) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset++) {
      consumeWork(ctx, 1);
      if (
        stringCodeUnit(haystack, start + offset) !==
        stringCodeUnit(needle, offset)
      ) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
};

const includesArray = (
  haystack: RuntimeValue[],
  needle: RuntimeValue,
  ctx: Ctx,
): boolean => {
  const lengthDescriptor = objectGetOwnPropertyDescriptor(haystack, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !numberIsSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new Error("std.includes expects an Array length data property");
  }
  const length = lengthDescriptor.value;
  for (let index = 0; index < length; index++) {
    consumeWork(ctx, 1);
    const descriptor = objectGetOwnPropertyDescriptor(
      haystack,
      StringConstructor(index),
    );
    if (descriptor === undefined) continue;
    if (!("value" in descriptor)) {
      throw new Error("std.includes array entries must be data properties");
    }
    if (descriptor.value === needle) return true;
  }
  return false;
};

const toSliceIndex = (value: number, length: number): number => {
  const integer = numberIsNaN(value)
    ? 0
    : numberIsFinite(value)
      ? mathTrunc(value)
      : value;
  if (integer === negativeInfinity) return 0;
  if (integer < 0) return mathMax(length + integer, 0);
  return mathMin(integer, length);
};

const sliceLength = (
  value: string,
  start: number,
  end: number | undefined,
): number => {
  const from = toSliceIndex(start, value.length);
  const to = end === undefined ? value.length : toSliceIndex(end, value.length);
  return mathMax(to - from, 0);
};

const callStandardFunction = (
  fn: RuntimeFunction,
  args: readonly RuntimeValue[],
  ctx: Ctx,
): StandardCallResult => {
  const invoke = (): RuntimeValue => reflectApply(fn, undefined, args);
  const first = args[0];
  const second = args[1];

  if (fn === std.lower || fn === std.upper || fn === std.trim) {
    if (typeof first === "string") consumeWork(ctx, first.length);
    return { handled: true, value: invoke() };
  }
  if (fn === std.startsWith || fn === std.endsWith) {
    if (typeof first === "string" && typeof second === "string") {
      consumeWork(ctx, second.length);
    }
    return { handled: true, value: invoke() };
  }
  if (fn === std.includes) {
    if (typeof first === "string" && typeof second === "string") {
      return { handled: true, value: includesString(first, second, ctx) };
    }
    if (isRuntimeArray(first)) {
      return { handled: true, value: includesArray(first, second, ctx) };
    }
    return { handled: true, value: invoke() };
  }
  if (fn === std.slice) {
    const end = args[2];
    if (
      typeof first === "string" &&
      typeof second === "number" &&
      (end === undefined || typeof end === "number")
    ) {
      consumeWork(ctx, sliceLength(first, second, end));
    }
    return { handled: true, value: invoke() };
  }
  return { handled: false };
};

const evalCallExpr = (expr: CallExpr, ctx: Ctx): EvalResult => {
  if (expr.args.length > ctx.maxCallArguments) {
    return evalError("call argument list too large", expr.span, ctx.steps);
  }

  let fn: RuntimeValue;
  let receiver: RuntimeValue | undefined;

  if (expr.callee.kind === "member") {
    const target = evalMemberCallTarget(expr.callee, ctx);
    if (!target.success) return target;
    receiver = target.receiver;
    fn = target.value;
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
  const standardCall = callStandardFunction(fn, args, ctx);
  const out: unknown = standardCall.handled
    ? standardCall.value
    : reflectApply(fn, receiver, args);
  if (!supportsRuntimeValue(out, ctx)) {
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
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
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
    !numberIsSafeInteger(start.value) ||
    !numberIsSafeInteger(end.value) ||
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

  const lengthDescriptor = Object.getOwnPropertyDescriptor(
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
    !numberIsSafeInteger(length) ||
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
          const child = Object.getOwnPropertyDescriptor(
            frame.value,
            StringConstructor(frame.index),
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
        const requireOperator = (
          type: "unary" | "binary",
        ): AstValidationResult => {
          const field = readAstProperty(node, "op");
          if (!field.ok) return astValidationError(field.message);
          if (typeof field.value !== "string") {
            return astValidationError("'op' must be a string");
          }
          const supported =
            type === "unary" ? isUnaryOp(field.value) : isBinaryOp(field.value);
          return supported
            ? { ok: true }
            : astValidationError(`unknown ${type} operator`);
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
            result = requireOperator("unary");
            if (result.ok) queueChild("expr");
            break;
          case "binary":
            result = requireOperator("binary");
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
 * counter for AST visits and variable-size interpreter work.
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
    readEvaluationLimit(
      opts.maxRuntimeDepth,
      DEFAULT_MAX_RUNTIME_DEPTH,
      "maxRuntimeDepth",
    ),
    readEvaluationLimit(
      opts.maxRuntimeEntries,
      DEFAULT_MAX_RUNTIME_ENTRIES,
      "maxRuntimeEntries",
    ),
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
  const prepared =
    opts.env === undefined ? undefined : getPreparedEnvironment(opts.env);
  if (prepared !== undefined && prepared.maxDepth > maxRuntimeDepth) {
    const error: EvalError = {
      message:
        `prepared environment requires maxRuntimeDepth >= ${prepared.maxDepth}; ` +
        `received ${maxRuntimeDepth}`,
      steps: 0,
    };
    if (throwOnError) throw new ExpEvalError(error);
    return { success: false, error };
  }
  if (prepared !== undefined && prepared.entries > maxRuntimeEntries) {
    const error: EvalError = {
      message:
        `prepared environment requires maxRuntimeEntries >= ${prepared.entries}; ` +
        `received ${maxRuntimeEntries}`,
      steps: 0,
    };
    if (throwOnError) throw new ExpEvalError(error);
    return { success: false, error };
  }

  const envRes =
    prepared === undefined
      ? normalizeEnv(opts.env as unknown, {
          maxDepth: maxRuntimeDepth,
          maxEntries: maxRuntimeEntries,
        })
      : undefined;
  if (envRes !== undefined && !envRes.ok) {
    const error: EvalError = { message: envRes.message, steps: 0 };
    if (throwOnError) throw new ExpEvalError(error);
    return { success: false, error };
  }

  let res: EvalResult;
  try {
    if (envRes !== undefined && Object.hasOwn(envRes.env, "std")) {
      res = evalError(
        "env['std'] is reserved (stdlib is always available as std.*)",
        undefined,
        0,
      );
    } else {
      const immutableContainers = prepared?.containers ?? createContainerSet();
      let env: Env;
      if (prepared !== undefined) {
        env = prepared.env;
      } else {
        if (envRes === undefined) {
          throw new Error("normalized environment is missing");
        }
        env = Object.create(null) as Env;
        Object.defineProperty(env, "std", {
          value: std,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        containerSetAdd(currentContainers, std);
        for (const [key, value] of Object.entries(envRes.env)) {
          Object.defineProperty(env, key, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
          if (value !== null && typeof value === "object") {
            containerSetAdd(currentContainers, value);
          }
        }
      }

      const ctx: Ctx = {
        env,
        currentContainers,
        immutableContainers,
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
