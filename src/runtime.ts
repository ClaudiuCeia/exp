/** Primitive runtime values supported by the evaluator. */
export type RuntimePrimitive = undefined | null | boolean | number | string;

/** A function callable from expressions (must accept/return `RuntimeValue`). */
export type RuntimeFunction = (...args: RuntimeValue[]) => RuntimeValue;

/** A `RuntimeValue` array. */
export interface RuntimeArray extends Array<RuntimeValue> {}

/** A plain object mapping string keys to `RuntimeValue`. */
export interface RuntimeObject {
  /** Own enumerable properties (prototype is ignored by the evaluator). */
  [key: string]: RuntimeValue;
}

/**
 * Allowed runtime data model for evaluation.
 *
 * Values are validated at runtime when present in `env`, and function return
 * values are also validated.
 */
export type RuntimeValue =
  | RuntimePrimitive
  | RuntimeArray
  | RuntimeObject
  | RuntimeFunction;

export type Env = Record<string, RuntimeValue>;

export const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export type RuntimeValueLimits = Readonly<{
  maxDepth: number;
  maxEntries: number;
}>;

type ValidationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; message: string }>;

type NormalizeOk = Readonly<{ ok: true; value: RuntimeValue }>;
type NormalizeErr = Readonly<{ ok: false; message: string }>;
type NormalizeResult = NormalizeOk | NormalizeErr;

const isAccessorDescriptor = (
  d: PropertyDescriptor,
): d is PropertyDescriptor & { get?: unknown; set?: unknown } => {
  return typeof d.get === "function" || typeof d.set === "function";
};

type TraversalState = {
  entries: number;
  limits: RuntimeValueLimits;
};

const consumeEntries = (
  state: TraversalState,
  count: number,
  path: string,
): ValidationResult => {
  if (count > state.limits.maxEntries - state.entries) {
    return { ok: false, message: `${path} exceeds the runtime entry limit` };
  }
  state.entries += count;
  return { ok: true };
};

const validateValue = (
  value: unknown,
  path: string,
  depth: number,
  state: TraversalState & { seen: WeakSet<object> },
): ValidationResult => {
  if (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "function"
  ) {
    return { ok: true };
  }

  if (depth > state.limits.maxDepth) {
    return { ok: false, message: `${path} exceeds the runtime depth limit` };
  }
  if (typeof value !== "object") {
    return { ok: false, message: `${path} is not a supported runtime value` };
  }
  if (state.seen.has(value)) return { ok: true };
  state.seen.add(value);

  if (Array.isArray(value)) {
    const lenDesc = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lenDesc === undefined ||
      isAccessorDescriptor(lenDesc) ||
      !("value" in lenDesc) ||
      typeof (lenDesc as { value: unknown }).value !== "number"
    ) {
      return { ok: false, message: `${path} must be an Array` };
    }

    const len = (lenDesc as { value: number }).value;
    const counted = consumeEntries(state, len, path);
    if (!counted.ok) return counted;
    for (let i = 0; i < len; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (d && isAccessorDescriptor(d)) {
        return {
          ok: false,
          message: `${path}[${i}] must be a data property`,
        };
      }

      const v = d && ("value" in d)
        ? (d as { value: unknown }).value
        : undefined;
      const r = validateValue(v, `${path}[${i}]`, depth + 1, state);
      if (!r.ok) return r;
    }

    return { ok: true };
  }

  if (isPlainObject(value)) {
    const descs = Object.getOwnPropertyDescriptors(value);
    const counted = consumeEntries(state, Reflect.ownKeys(descs).length, path);
    if (!counted.ok) return counted;
    for (const [k, d] of Object.entries(descs)) {
      // Ignore non-enumerable properties by design.
      if (!d.enumerable) continue;
      if (isAccessorDescriptor(d)) {
        return {
          ok: false,
          message: `${path}['${k}'] must be a data property`,
        };
      }
      if (!("value" in d)) {
        return {
          ok: false,
          message: `${path}['${k}'] must be a data property`,
        };
      }
      const r = validateValue(
        (d as { value: unknown }).value,
        `${path}['${k}']`,
        depth + 1,
        state,
      );
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  return { ok: false, message: `${path} is not a supported runtime value` };
};

const normalizeRuntimeValue = (
  value: unknown,
  path: string,
  depth: number,
  state: TraversalState & { seen: WeakMap<object, RuntimeValue> },
): NormalizeResult => {
  if (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "function"
  ) {
    return { ok: true, value: value as RuntimeValue };
  }

  if (depth > state.limits.maxDepth) {
    return { ok: false, message: `${path} exceeds the runtime depth limit` };
  }
  if (typeof value !== "object") {
    return { ok: false, message: `${path} is not a supported runtime value` };
  }
  const seen = state.seen.get(value);
  if (seen !== undefined) return { ok: true, value: seen };

  if (Array.isArray(value)) {
    const lenDesc = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lenDesc === undefined ||
      isAccessorDescriptor(lenDesc) ||
      !("value" in lenDesc) ||
      typeof (lenDesc as { value: unknown }).value !== "number"
    ) {
      return { ok: false, message: `${path} must be an Array` };
    }
    const len = (lenDesc as { value: number }).value;
    const counted = consumeEntries(state, len, path);
    if (!counted.ok) return counted;
    const out: RuntimeValue[] = new Array(len);
    state.seen.set(value, out);
    for (let i = 0; i < len; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (d && isAccessorDescriptor(d)) {
        return {
          ok: false,
          message: `${path}[${i}] must be a data property`,
        };
      }
      const v = d && ("value" in d)
        ? (d as { value: unknown }).value
        : undefined;
      const nr = normalizeRuntimeValue(v, `${path}[${i}]`, depth + 1, state);
      if (!nr.ok) return nr;
      out[i] = nr.value;
    }
    return { ok: true, value: out };
  }

  if (!isPlainObject(value)) {
    return { ok: false, message: `${path} is not a supported runtime value` };
  }

  const out = Object.create(null) as Env;
  state.seen.set(value, out);
  const descs = Object.getOwnPropertyDescriptors(
    value as Record<string, unknown>,
  );
  const counted = consumeEntries(state, Reflect.ownKeys(descs).length, path);
  if (!counted.ok) return counted;
  for (const [k, d] of Object.entries(descs)) {
    if (!d.enumerable) continue;
    if (isAccessorDescriptor(d) || !("value" in d)) {
      return { ok: false, message: `${path}['${k}'] must be a data property` };
    }
    const nr = normalizeRuntimeValue(
      (d as { value: unknown }).value,
      `${path}['${k}']`,
      depth + 1,
      state,
    );
    if (!nr.ok) return nr;
    Object.defineProperty(out, k, {
      value: nr.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { ok: true, value: out };
};

export const isRuntimeValue = (
  value: unknown,
  limits: RuntimeValueLimits = { maxDepth: 64, maxEntries: 10_000 },
): value is RuntimeValue => {
  try {
    return validateValue(value, "value", 0, {
      entries: 0,
      limits,
      seen: new WeakSet(),
    }).ok;
  } catch {
    return false;
  }
};

export const normalizeEnv = (
  env: unknown,
  limits: RuntimeValueLimits = { maxDepth: 64, maxEntries: 10_000 },
): { ok: true; env: Env } | { ok: false; message: string } => {
  if (env === undefined) return { ok: true, env: {} };
  try {
    if (!isPlainObject(env)) {
      return {
        ok: false,
        message: "env must be a plain object (or proto-null object)",
      };
    }

    const normalized = normalizeRuntimeValue(env, "env", 0, {
      entries: 0,
      limits,
      seen: new WeakMap(),
    });
    if (!normalized.ok) return normalized;
    return { ok: true, env: normalized.value as Env };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
