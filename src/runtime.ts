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

type ValidationOk = Readonly<{ ok: true }>;
type ValidationErr = Readonly<{ ok: false; message: string }>;
type ValidationResult = ValidationOk | ValidationErr;

type NormalizeOk = Readonly<{ ok: true; value: RuntimeValue }>;
type NormalizeErr = Readonly<{ ok: false; message: string }>;
type NormalizeResult = NormalizeOk | NormalizeErr;

const isAccessorDescriptor = (
  d: PropertyDescriptor,
): d is PropertyDescriptor & { get?: unknown; set?: unknown } => {
  return typeof d.get === "function" || typeof d.set === "function";
};

const validateRuntimeValue = (
  value: unknown,
  path: string,
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

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return { ok: false, message: `${path} must be an Array` };
    }

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
      const r = validateRuntimeValue(v, `${path}[${i}]`);
      if (!r.ok) return r;
    }

    return { ok: true };
  }

  if (isPlainObject(value)) {
    const descs = Object.getOwnPropertyDescriptors(value);
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
      const r = validateRuntimeValue(
        (d as { value: unknown }).value,
        `${path}['${k}']`,
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
): NormalizeResult => {
  const valid = validateRuntimeValue(value, path);
  if (!valid.ok) return valid;

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

  if (Array.isArray(value)) {
    const len = (value as unknown[]).length;
    const out: RuntimeValue[] = new Array(len);
    for (let i = 0; i < len; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      const v = d && ("value" in d)
        ? (d as { value: unknown }).value
        : undefined;
      const nr = normalizeRuntimeValue(v, `${path}[${i}]`);
      if (!nr.ok) return nr;
      out[i] = nr.value;
    }
    return { ok: true, value: out };
  }

  // Plain object.
  const out = Object.create(null) as Env;
  const descs = Object.getOwnPropertyDescriptors(
    value as Record<string, unknown>,
  );
  for (const [k, d] of Object.entries(descs)) {
    if (!d.enumerable) continue;
    // Accessors are already rejected by validateRuntimeValue.
    if (!("value" in d)) {
      return { ok: false, message: `${path}['${k}'] must be a data property` };
    }
    const nr = normalizeRuntimeValue(
      (d as { value: unknown }).value,
      `${path}['${k}']`,
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

export const isRuntimeValue = (value: unknown): value is RuntimeValue => {
  return validateRuntimeValue(value, "value").ok;
};

export const normalizeEnv = (
  env: unknown,
): { ok: true; env: Env } | { ok: false; message: string } => {
  if (env === undefined) return { ok: true, env: {} };
  if (!isPlainObject(env)) {
    return {
      ok: false,
      message: "env must be a plain object (or proto-null object)",
    };
  }

  const out = Object.create(null) as Env;
  const descs = Object.getOwnPropertyDescriptors(env);
  for (const [k, d] of Object.entries(descs)) {
    if (!d.enumerable) continue;
    if (isAccessorDescriptor(d) || !("value" in d)) {
      return { ok: false, message: `env['${k}'] must be a data property` };
    }

    const nr = normalizeRuntimeValue(
      (d as { value: unknown }).value,
      `env['${k}']`,
    );
    if (!nr.ok) return { ok: false, message: nr.message };

    Object.defineProperty(out, k, {
      value: nr.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return { ok: true, env: out };
};
