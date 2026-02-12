import type { RuntimeValue } from "./runtime.ts";

const expectNumber = (v: RuntimeValue, name: string): number => {
  if (typeof v !== "number") throw new Error(`${name} expects numbers`);
  return v;
};

const expectString = (v: RuntimeValue, name: string): string => {
  if (typeof v !== "string") throw new Error(`${name} expects strings`);
  return v;
};

/**
 * Default standard library, always available as `std.*`.
 *
 * Deterministic, side-effect-free helpers only.
 */
export const std: Record<string, RuntimeValue> = Object.assign(
  Object.create(null),
  {
    // Length helper.
    len: (x: RuntimeValue): RuntimeValue => {
      if (typeof x === "string" || Array.isArray(x)) return x.length;
      throw new Error("std.len(x) expects a string or array");
    },

    // Math.
    abs: (x: RuntimeValue) => Math.abs(expectNumber(x, "std.abs(x)")),
    min: (a: RuntimeValue, b: RuntimeValue) =>
      Math.min(
        expectNumber(a, "std.min(a,b)"),
        expectNumber(b, "std.min(a,b)"),
      ),
    max: (a: RuntimeValue, b: RuntimeValue) =>
      Math.max(
        expectNumber(a, "std.max(a,b)"),
        expectNumber(b, "std.max(a,b)"),
      ),
    clamp: (x: RuntimeValue, lo: RuntimeValue, hi: RuntimeValue) => {
      const nx = expectNumber(x, "std.clamp(x,lo,hi)");
      const nlo = expectNumber(lo, "std.clamp(x,lo,hi)");
      const nhi = expectNumber(hi, "std.clamp(x,lo,hi)");
      return Math.min(nhi, Math.max(nlo, nx));
    },
    floor: (x: RuntimeValue) => Math.floor(expectNumber(x, "std.floor(x)")),
    ceil: (x: RuntimeValue) => Math.ceil(expectNumber(x, "std.ceil(x)")),
    round: (x: RuntimeValue) => Math.round(expectNumber(x, "std.round(x)")),
    trunc: (x: RuntimeValue) => Math.trunc(expectNumber(x, "std.trunc(x)")),
    sqrt: (x: RuntimeValue) => Math.sqrt(expectNumber(x, "std.sqrt(x)")),
    pow: (a: RuntimeValue, b: RuntimeValue) =>
      Math.pow(
        expectNumber(a, "std.pow(a,b)"),
        expectNumber(b, "std.pow(a,b)"),
      ),

    // Strings.
    lower: (s: RuntimeValue) => expectString(s, "std.lower(s)").toLowerCase(),
    upper: (s: RuntimeValue) => expectString(s, "std.upper(s)").toUpperCase(),
    trim: (s: RuntimeValue) => expectString(s, "std.trim(s)").trim(),
    startsWith: (s: RuntimeValue, prefix: RuntimeValue) =>
      expectString(s, "std.startsWith(s,prefix)").startsWith(
        expectString(prefix, "std.startsWith(s,prefix)"),
      ),
    endsWith: (s: RuntimeValue, suffix: RuntimeValue) =>
      expectString(s, "std.endsWith(s,suffix)").endsWith(
        expectString(suffix, "std.endsWith(s,suffix)"),
      ),
    includes: (haystack: RuntimeValue, needle: RuntimeValue) => {
      if (typeof haystack === "string") {
        return haystack.includes(
          expectString(needle, "std.includes(haystack,needle)"),
        );
      }

      if (Array.isArray(haystack)) {
        return haystack.some((x) => x === needle);
      }

      throw new Error(
        "std.includes(haystack,needle) expects (string,string) or (array,value)",
      );
    },
    slice: (s: RuntimeValue, start: RuntimeValue, end?: RuntimeValue) => {
      const str = expectString(s, "std.slice(s,start,end?)");
      const a = expectNumber(start, "std.slice(s,start,end?)");
      if (end === undefined) return str.slice(a);
      const b = expectNumber(end, "std.slice(s,start,end?)");
      return str.slice(a, b);
    },
  } satisfies Record<string, RuntimeValue>,
);
