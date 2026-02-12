import { evaluateAst, evaluateExpression } from "../src/eval.ts";
import { parseExpression } from "../src/parse.ts";
import type { Expr } from "../src/ast/mod.ts";

const SIMPLE_EXPR = "status == 'open' && priority >= 3";

const COMPLEX_EXPR = `(
  user.isInternal == true
  || std.includes(allowlist, user.id)
  || (
    (user.plan ?? "free") != "free"
    && user.status == "active"
    && !std.includes(blockedEmails, std.lower(user.email ?? ""))
    && (user.age ?? 0) >= 18
    && (
      std.clamp((user.rolloutBucket ?? 0), 0, 99) < rolloutPercent
      || std.includes(forcedBuckets, user.rolloutBucket ?? -1)
    )
  )
)
&& !std.includes(bannedCountries, user.country ?? "XX")`;

const mustParse = (input: string): Expr => {
  const res = parseExpression(input, { throwOnError: false });
  if (!res.success) throw new Error(res.error.message);
  return res.value;
};

const simpleAst = mustParse(SIMPLE_EXPR);
const complexAst = mustParse(COMPLEX_EXPR);

const simpleEnv = {
  status: "open",
  priority: 4,
};

const complexEnv = {
  user: {
    id: "u_123",
    email: "Ada@example.com",
    plan: "pro",
    status: "active",
    country: "US",
    age: 29,
    rolloutBucket: 17,
    isInternal: false,
  },
  allowlist: ["u_999"],
  blockedEmails: ["bad@example.com", "test@example.com"],
  forcedBuckets: [42, 77],
  bannedCountries: ["CN", "RU"],
  rolloutPercent: 25,
};

const jsClamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) return Number.NaN;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const jsSimple = (): boolean => {
  return simpleEnv.status === "open" && simpleEnv.priority >= 3;
};

const jsComplex = (): boolean => {
  const user = complexEnv.user;

  const isInternal = user.isInternal === true;
  if (isInternal) return true;

  if (complexEnv.allowlist.includes(user.id)) return true;

  const plan = user.plan ?? "free";
  if (plan === "free") return false;
  if (user.status !== "active") return false;

  const emailLower = (user.email ?? "").toLowerCase();
  if (complexEnv.blockedEmails.includes(emailLower)) return false;

  const age = user.age ?? 0;
  if (age < 18) return false;

  const bucket = user.rolloutBucket ?? 0;
  const inRollout = jsClamp(bucket, 0, 99) < complexEnv.rolloutPercent;
  const forced = complexEnv.forcedBuckets.includes(user.rolloutBucket ?? -1);
  if (!(inRollout || forced)) return false;

  const country = user.country ?? "XX";
  if (complexEnv.bannedCountries.includes(country)) return false;

  return true;
};

Deno.bench("evalAst: simple filter", () => {
  const res = evaluateAst(simpleAst, { env: simpleEnv, throwOnError: true });
  // Ensure result is used.
  if (!res.success) throw new Error("unexpected eval failure");
  if (res.value !== true) throw new Error("unexpected value");
});

Deno.bench("js: simple filter", () => {
  const value = jsSimple();
  if (value !== true) throw new Error("unexpected value");
});

Deno.bench("evalExpression: simple filter (parse+eval)", () => {
  const res = evaluateExpression(SIMPLE_EXPR, {
    env: simpleEnv,
    throwOnError: true,
  });
  if (!res.success) throw new Error("unexpected eval failure");
  if (res.value !== true) throw new Error("unexpected value");
});

Deno.bench("evalAst: complex rule", () => {
  const res = evaluateAst(complexAst, { env: complexEnv, throwOnError: true });
  if (!res.success) throw new Error("unexpected eval failure");
  // Expected: should be true for this env.
  if (res.value !== true) throw new Error("unexpected value");
});

Deno.bench("js: complex rule", () => {
  const value = jsComplex();
  if (value !== true) throw new Error("unexpected value");
});

Deno.bench("evalExpression: complex rule (parse+eval)", () => {
  const res = evaluateExpression(COMPLEX_EXPR, {
    env: complexEnv,
    throwOnError: true,
  });
  if (!res.success) throw new Error("unexpected eval failure");
  if (res.value !== true) throw new Error("unexpected value");
});
