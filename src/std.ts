import type { RuntimeValue } from "./runtime.ts";

const arrayIsArray = Array.isArray;
const arraySome = Array.prototype.some;
const mathAbs = Math.abs;
const mathCeil = Math.ceil;
const mathFloor = Math.floor;
const mathMax = Math.max;
const mathMin = Math.min;
const mathPow = Math.pow;
const mathRound = Math.round;
const mathSqrt = Math.sqrt;
const mathTrunc = Math.trunc;
const reflectApply = Reflect.apply;
const stringEndsWith = String.prototype.endsWith;
const stringIncludes = String.prototype.includes;
const stringSlice = String.prototype.slice;
const stringStartsWith = String.prototype.startsWith;
const stringToLowerCase = String.prototype.toLowerCase;
const stringToUpperCase = String.prototype.toUpperCase;
const stringTrim = String.prototype.trim;

const callStringTransform = (
  method: (this: string) => string,
  value: string,
): string => reflectApply(method, value, []);

const callStringSearch = (
  method: (this: string, search: string) => boolean,
  value: string,
  search: string,
): boolean => reflectApply(method, value, [search]);

const expectNumber = (v: RuntimeValue, name: string): number => {
  if (typeof v !== "number") throw new Error(`${name} expects numbers`);
  return v;
};

const expectString = (v: RuntimeValue, name: string): string => {
  if (typeof v !== "string") throw new Error(`${name} expects strings`);
  return v;
};

/** Exact public shape of the built-in standard library. */
export type StandardLibrary = Readonly<{
  len: (x: RuntimeValue) => number;
  abs: (x: RuntimeValue) => number;
  min: (a: RuntimeValue, b: RuntimeValue) => number;
  max: (a: RuntimeValue, b: RuntimeValue) => number;
  clamp: (x: RuntimeValue, lo: RuntimeValue, hi: RuntimeValue) => number;
  floor: (x: RuntimeValue) => number;
  ceil: (x: RuntimeValue) => number;
  round: (x: RuntimeValue) => number;
  trunc: (x: RuntimeValue) => number;
  sqrt: (x: RuntimeValue) => number;
  pow: (a: RuntimeValue, b: RuntimeValue) => number;
  lower: (s: RuntimeValue) => string;
  upper: (s: RuntimeValue) => string;
  trim: (s: RuntimeValue) => string;
  startsWith: (s: RuntimeValue, prefix: RuntimeValue) => boolean;
  endsWith: (s: RuntimeValue, suffix: RuntimeValue) => boolean;
  includes: (haystack: RuntimeValue, needle: RuntimeValue) => boolean;
  slice: (s: RuntimeValue, start: RuntimeValue, end?: RuntimeValue) => string;
}>;

/**
 * Default standard library, always available as `std.*`.
 *
 * Deterministic, side-effect-free helpers only.
 */
const stdValues: StandardLibrary = Object.assign(
  // `object` avoids widening the assigned contract with an index signature.
  Object.create(null) as object,
  {
    // Length helper.
    len: (x: RuntimeValue) => {
      if (typeof x === "string" || arrayIsArray(x)) return x.length;
      throw new Error("std.len(x) expects a string or array");
    },

    // Math.
    abs: (x: RuntimeValue) => mathAbs(expectNumber(x, "std.abs(x)")),
    min: (a: RuntimeValue, b: RuntimeValue) =>
      mathMin(expectNumber(a, "std.min(a,b)"), expectNumber(b, "std.min(a,b)")),
    max: (a: RuntimeValue, b: RuntimeValue) =>
      mathMax(expectNumber(a, "std.max(a,b)"), expectNumber(b, "std.max(a,b)")),
    clamp: (x: RuntimeValue, lo: RuntimeValue, hi: RuntimeValue) => {
      const nx = expectNumber(x, "std.clamp(x,lo,hi)");
      const nlo = expectNumber(lo, "std.clamp(x,lo,hi)");
      const nhi = expectNumber(hi, "std.clamp(x,lo,hi)");
      return mathMin(nhi, mathMax(nlo, nx));
    },
    floor: (x: RuntimeValue) => mathFloor(expectNumber(x, "std.floor(x)")),
    ceil: (x: RuntimeValue) => mathCeil(expectNumber(x, "std.ceil(x)")),
    round: (x: RuntimeValue) => mathRound(expectNumber(x, "std.round(x)")),
    trunc: (x: RuntimeValue) => mathTrunc(expectNumber(x, "std.trunc(x)")),
    sqrt: (x: RuntimeValue) => mathSqrt(expectNumber(x, "std.sqrt(x)")),
    pow: (a: RuntimeValue, b: RuntimeValue) =>
      mathPow(expectNumber(a, "std.pow(a,b)"), expectNumber(b, "std.pow(a,b)")),

    // Strings.
    lower: (s: RuntimeValue) =>
      callStringTransform(stringToLowerCase, expectString(s, "std.lower(s)")),
    upper: (s: RuntimeValue) =>
      callStringTransform(stringToUpperCase, expectString(s, "std.upper(s)")),
    trim: (s: RuntimeValue) =>
      callStringTransform(stringTrim, expectString(s, "std.trim(s)")),
    startsWith: (s: RuntimeValue, prefix: RuntimeValue) =>
      callStringSearch(
        stringStartsWith,
        expectString(s, "std.startsWith(s,prefix)"),
        expectString(prefix, "std.startsWith(s,prefix)"),
      ),
    endsWith: (s: RuntimeValue, suffix: RuntimeValue) =>
      callStringSearch(
        stringEndsWith,
        expectString(s, "std.endsWith(s,suffix)"),
        expectString(suffix, "std.endsWith(s,suffix)"),
      ),
    includes: (haystack: RuntimeValue, needle: RuntimeValue) => {
      if (typeof haystack === "string") {
        return callStringSearch(
          stringIncludes,
          haystack,
          expectString(needle, "std.includes(haystack,needle)"),
        );
      }

      if (arrayIsArray(haystack)) {
        return reflectApply(arraySome, haystack, [
          (value: RuntimeValue) => value === needle,
        ]);
      }

      throw new Error(
        "std.includes(haystack,needle) expects (string,string) or (array,value)",
      );
    },
    slice: (s: RuntimeValue, start: RuntimeValue, end?: RuntimeValue) => {
      const str = expectString(s, "std.slice(s,start,end?)");
      const a = expectNumber(start, "std.slice(s,start,end?)");
      if (end === undefined) return reflectApply(stringSlice, str, [a]);
      const b = expectNumber(end, "std.slice(s,start,end?)");
      return reflectApply(stringSlice, str, [a, b]);
    },
  } satisfies StandardLibrary,
);

for (const value of Object.values(stdValues)) {
  if (typeof value === "function") Object.freeze(value);
}

export const std: StandardLibrary = Object.freeze(stdValues);
