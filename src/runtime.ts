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

type TraversalOk = Readonly<{ ok: true; value: RuntimeValue }>;
type TraversalErr = Readonly<{ ok: false; message: string }>;
type TraversalResult = TraversalOk | TraversalErr;

type TraversalBaseState = {
  entries: number;
  readonly limits: RuntimeValueLimits;
};

type TraversalState = TraversalBaseState &
  (
    | Readonly<{ mode: "validate"; seen: WeakSet<object> }>
    | Readonly<{
        mode: "normalize";
        seen: WeakMap<object, RuntimeValue>;
      }>
  );

type RuntimePath =
  | Readonly<{ kind: "root"; value: string }>
  | Readonly<{ kind: "child"; parent: RuntimePath; segment: string }>;

type NormalizeTarget =
  | Readonly<{ kind: "array"; value: RuntimeArray; index: number }>
  | Readonly<{ kind: "object"; value: RuntimeObject; key: string }>;

type ArrayFrameBase = Readonly<{
  kind: "array";
  value: RuntimeArray;
  path: RuntimePath;
  depth: number;
  length: number;
  previous: TraversalFrame | undefined;
}> & {
  index: number;
};

type ArrayFrame = ArrayFrameBase &
  (
    | Readonly<{ mode: "validate" }>
    | Readonly<{
        mode: "normalize";
        output: RuntimeArray;
        target: NormalizeTarget | undefined;
      }>
  );

type ObjectFrameBase = Readonly<{
  kind: "object";
  entries: ReadonlyArray<readonly [string, PropertyDescriptor]>;
  path: RuntimePath;
  depth: number;
  previous: TraversalFrame | undefined;
}> & {
  index: number;
};

type ObjectFrame = ObjectFrameBase &
  (
    | Readonly<{ mode: "validate" }>
    | Readonly<{
        mode: "normalize";
        output: RuntimeObject;
        target: NormalizeTarget | undefined;
      }>
  );

type TraversalFrame = ArrayFrame | ObjectFrame;

type EntryResult = Readonly<{ ok: true }> | TraversalErr;

const formatRuntimePath = (path: RuntimePath): string => {
  let formatted = "";
  let current = path;
  while (current.kind === "child") {
    formatted = current.segment + formatted;
    current = current.parent;
  }
  return current.value + formatted;
};

const traversalError = (path: RuntimePath, message: string): TraversalErr => ({
  ok: false,
  message: `${formatRuntimePath(path)} ${message}`,
});

const consumeEntries = (
  state: TraversalState,
  count: number,
  path: RuntimePath,
): EntryResult => {
  if (count > state.limits.maxEntries - state.entries) {
    return traversalError(path, "exceeds the runtime entry limit");
  }
  state.entries += count;
  return { ok: true };
};

const isRuntimeLeaf = (
  value: unknown,
): value is RuntimePrimitive | RuntimeFunction => {
  return (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "function"
  );
};

const traverseRuntimeValue = (
  value: unknown,
  path: string,
  depth: number,
  state: TraversalState,
): TraversalResult => {
  const rootPath: RuntimePath = { kind: "root", value: path };
  let topFrame: TraversalFrame | undefined;
  let currentValue = value;
  let currentPath: RuntimePath = rootPath;
  let currentDepth = depth;
  let currentTarget: NormalizeTarget | undefined;
  let normalized: RuntimeValue = undefined;

  const assignNormalized = (
    target: NormalizeTarget | undefined,
    normalizedValue: RuntimeValue,
  ): void => {
    if (target === undefined) {
      normalized = normalizedValue;
    } else if (target.kind === "array") {
      target.value[target.index] = normalizedValue;
    } else {
      Object.defineProperty(target.value, target.key, {
        value: normalizedValue,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  };

  while (true) {
    if (isRuntimeLeaf(currentValue)) {
      if (state.mode === "normalize") {
        assignNormalized(currentTarget, currentValue);
      }
    } else {
      if (currentDepth > state.limits.maxDepth) {
        return traversalError(currentPath, "exceeds the runtime depth limit");
      }
      if (typeof currentValue !== "object") {
        return traversalError(currentPath, "is not a supported runtime value");
      }

      let alreadySeen = false;
      if (state.mode === "validate") {
        alreadySeen = state.seen.has(currentValue);
        if (!alreadySeen) state.seen.add(currentValue);
      } else {
        const seen = state.seen.get(currentValue);
        if (seen !== undefined) {
          assignNormalized(currentTarget, seen);
          alreadySeen = true;
        }
      }

      if (!alreadySeen) {
        if (Array.isArray(currentValue)) {
          const lengthDescriptor = Object.getOwnPropertyDescriptor(
            currentValue,
            "length",
          );
          if (
            lengthDescriptor === undefined ||
            !("value" in lengthDescriptor) ||
            typeof lengthDescriptor.value !== "number"
          ) {
            return traversalError(currentPath, "must be an Array");
          }

          const length = lengthDescriptor.value;
          const counted = consumeEntries(state, length, currentPath);
          if (!counted.ok) return counted;

          if (state.mode === "normalize") {
            const output: RuntimeArray = Array.from({ length });
            state.seen.set(currentValue, output);
            topFrame = {
              kind: "array",
              mode: "normalize",
              value: currentValue,
              output,
              path: currentPath,
              depth: currentDepth,
              index: 0,
              length,
              target: currentTarget,
              previous: topFrame,
            };
          } else {
            topFrame = {
              kind: "array",
              mode: "validate",
              value: currentValue,
              path: currentPath,
              depth: currentDepth,
              index: 0,
              length,
              previous: topFrame,
            };
          }
        } else {
          if (!isPlainObject(currentValue)) {
            return traversalError(
              currentPath,
              "is not a supported runtime value",
            );
          }

          let output: RuntimeObject | undefined;
          if (state.mode === "normalize") {
            output = Object.create(null) as RuntimeObject;
            state.seen.set(currentValue, output);
          }
          const descriptors = Object.getOwnPropertyDescriptors(currentValue);
          const counted = consumeEntries(
            state,
            Reflect.ownKeys(descriptors).length,
            currentPath,
          );
          if (!counted.ok) return counted;
          const entries = Object.entries(descriptors);

          if (state.mode === "normalize") {
            if (output === undefined) {
              throw new Error("runtime normalization object output is missing");
            }
            topFrame = {
              kind: "object",
              mode: "normalize",
              entries,
              output,
              path: currentPath,
              depth: currentDepth,
              index: 0,
              target: currentTarget,
              previous: topFrame,
            };
          } else {
            topFrame = {
              kind: "object",
              mode: "validate",
              entries,
              path: currentPath,
              depth: currentDepth,
              index: 0,
              previous: topFrame,
            };
          }
        }
      }
    }

    let hasNextValue = false;
    while (topFrame !== undefined) {
      const frame = topFrame;
      if (frame.kind === "array") {
        if (frame.index >= frame.length) {
          topFrame = frame.previous;
          if (frame.mode === "normalize") {
            assignNormalized(frame.target, frame.output);
          }
          continue;
        }

        const index = frame.index;
        const descriptor = Object.getOwnPropertyDescriptor(
          frame.value,
          String(index),
        );
        frame.index++;
        if (descriptor !== undefined && !("value" in descriptor)) {
          return traversalError(
            {
              kind: "child",
              parent: frame.path,
              segment: `[${index}]`,
            },
            "must be a data property",
          );
        }

        const childValue =
          descriptor === undefined ? undefined : descriptor.value;
        if (isRuntimeLeaf(childValue)) {
          if (frame.mode === "normalize") frame.output[index] = childValue;
          continue;
        }

        currentValue = childValue;
        currentPath = {
          kind: "child",
          parent: frame.path,
          segment: `[${index}]`,
        };
        currentDepth = frame.depth + 1;
        currentTarget =
          frame.mode === "normalize"
            ? { kind: "array", value: frame.output, index }
            : undefined;
        hasNextValue = true;
        break;
      }

      if (frame.index >= frame.entries.length) {
        topFrame = frame.previous;
        if (frame.mode === "normalize") {
          assignNormalized(frame.target, frame.output);
        }
        continue;
      }

      const entry = frame.entries[frame.index];
      if (entry === undefined) {
        throw new Error("runtime traversal object entry is missing");
      }
      frame.index++;
      const [key, descriptor] = entry;
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) {
        return traversalError(
          {
            kind: "child",
            parent: frame.path,
            segment: `['${key}']`,
          },
          "must be a data property",
        );
      }

      const childValue = descriptor.value;
      if (isRuntimeLeaf(childValue)) {
        if (frame.mode === "normalize") {
          Object.defineProperty(frame.output, key, {
            value: childValue,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        continue;
      }

      currentValue = childValue;
      currentPath = {
        kind: "child",
        parent: frame.path,
        segment: `['${key}']`,
      };
      currentDepth = frame.depth + 1;
      currentTarget =
        frame.mode === "normalize"
          ? { kind: "object", value: frame.output, key }
          : undefined;
      hasNextValue = true;
      break;
    }

    if (!hasNextValue) {
      return {
        ok: true,
        value: state.mode === "validate" ? (value as RuntimeValue) : normalized,
      };
    }
  }
};

export const isRuntimeValue = (
  value: unknown,
  limits: RuntimeValueLimits = { maxDepth: 64, maxEntries: 10_000 },
): value is RuntimeValue => {
  try {
    return traverseRuntimeValue(value, "value", 0, {
      entries: 0,
      limits,
      mode: "validate",
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

    const normalized = traverseRuntimeValue(env, "env", 0, {
      entries: 0,
      limits,
      mode: "normalize",
      seen: new WeakMap(),
    });
    if (!normalized.ok) return normalized;
    return { ok: true, env: normalized.value as Env };
  } catch {
    return {
      ok: false,
      message: "environment inspection failed",
    };
  }
};
