import { assert } from "@std/assert";
import { evaluateExpression } from "../src/eval.ts";
import { parseExpression } from "../src/parse.ts";

const mulberry32 = (seed: number): () => number => {
  let a = seed | 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randInt = (rng: () => number, maxExclusive: number): number => {
  return Math.floor(rng() * maxExclusive);
};

const chance = (rng: () => number, p: number): boolean => rng() < p;

const choose = <T>(rng: () => number, items: readonly T[]): T => {
  return items[randInt(rng, items.length)];
};

const RESERVED = ["true", "false", "null", "undefined"] as const;

const genIdent = (rng: () => number): string => {
  if (chance(rng, 0.08)) return choose(rng, RESERVED);

  const startChars = "_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const continueChars = startChars + "0123456789";

  const len = 1 + randInt(rng, 10);
  let out = startChars[randInt(rng, startChars.length)];
  for (let i = 1; i < len; i++) {
    out += continueChars[randInt(rng, continueChars.length)];
  }
  return out;
};

const genNumber = (rng: () => number): string => {
  const sign = chance(rng, 0.2) ? "-" : "";
  const whole = String(randInt(rng, 1_000));
  if (!chance(rng, 0.25)) return sign + whole;
  const frac = String(randInt(rng, 1_000));
  return `${sign}${whole}.${frac}`;
};

const genString = (rng: () => number): string => {
  const quote = chance(rng, 0.5) ? "'" : '"';
  const len = randInt(rng, 14);
  let out = quote;
  for (let i = 0; i < len; i++) {
    const r = rng();
    if (r < 0.08) out += "\\\\";
    else if (r < 0.12) out += "\\n";
    else if (r < 0.16) out += "\\t";
    else if (r < 0.20) out += "\\" + quote;
    else {out +=
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _"[
          randInt(rng, 63)
        ];}
  }
  out += quote;
  return out;
};

const maybeWs = (rng: () => number): string => {
  return chance(rng, 0.35) ? " " : "";
};

const genPostfix = (rng: () => number, base: string, depth: number): string => {
  let out = base;
  // Chain a couple of postfix ops (member/call) sometimes.
  for (let i = 0; i < 3 && chance(rng, 0.25); i++) {
    if (chance(rng, 0.6)) {
      out += `.${genIdent(rng)}`;
      continue;
    }

    // call
    const argc = randInt(rng, 4);
    const args: string[] = [];
    for (let a = 0; a < argc; a++) {
      args.push(genExpr(rng, depth + 1));
    }
    out += `(${args.join(",")})`;
  }
  return out;
};

const genArray = (rng: () => number, depth: number): string => {
  const n = randInt(rng, 5);
  const items: string[] = [];
  for (let i = 0; i < n; i++) items.push(genExpr(rng, depth + 1));
  return `[${items.join(",")}]`;
};

const genPrimary = (rng: () => number, depth: number): string => {
  const atom = () => {
    const kind = randInt(rng, 7);
    switch (kind) {
      case 0:
        return genNumber(rng);
      case 1:
        return genString(rng);
      case 2:
        return genIdent(rng);
      case 3:
        return choose(rng, RESERVED);
      case 4:
        return "std";
      case 5:
        return genArray(rng, depth);
      default:
        return `(${genExpr(rng, depth + 1)})`;
    }
  };

  const base = atom();
  return genPostfix(rng, base, depth);
};

const BINARY_OPS = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "&&",
  "||",
  "??",
] as const;

const UNARY_OPS = ["!", "+", "-"] as const;

const genExpr = (rng: () => number, depth = 0): string => {
  if (depth > 3) return genPrimary(rng, depth);

  // 10%: conditional
  if (chance(rng, 0.10)) {
    const test = genExpr(rng, depth + 1);
    const cons = genExpr(rng, depth + 1);
    const alt = genExpr(rng, depth + 1);
    return `(${test}${maybeWs(rng)}?${maybeWs(rng)}${cons}${maybeWs(rng)}:${
      maybeWs(rng)
    }${alt})`;
  }

  // 10%: pipeline
  if (chance(rng, 0.10)) {
    const lhs = genExpr(rng, depth + 1);
    const rhs = genPostfix(rng, genIdent(rng), depth + 1);
    return `(${lhs}${maybeWs(rng)}|>${maybeWs(rng)}${rhs})`;
  }

  // Otherwise: a binary chain.
  const parts: string[] = [];
  if (chance(rng, 0.15)) {
    parts.push(choose(rng, UNARY_OPS) + maybeWs(rng) + genPrimary(rng, depth));
  } else {
    parts.push(genPrimary(rng, depth));
  }

  const opsCount = 1 + randInt(rng, 6);
  for (let i = 0; i < opsCount; i++) {
    const op = choose(rng, BINARY_OPS);
    const rhs = genPrimary(rng, depth);
    parts.push(`${maybeWs(rng)}${op}${maybeWs(rng)}${rhs}`);
  }

  return parts.join("");
};

Deno.test("fuzz: parseExpression never throws in non-throwing mode", () => {
  const seed = 0xC0FFEE;
  const rng = mulberry32(seed);

  for (let i = 0; i < 2_000; i++) {
    const input = genExpr(rng);

    let res;
    try {
      res = parseExpression(input, { throwOnError: false });
    } catch (err) {
      throw new Error(
        `parseExpression threw (seed=${seed}, i=${i}, input=${
          JSON.stringify(input)
        }): ${String(err)}`,
      );
    }

    if (res.success) {
      assert(res.value.span.start >= 0);
      assert(res.value.span.end >= res.value.span.start);
      assert(res.value.span.end <= input.length);
    } else {
      assert(res.error.index >= 0);
      assert(res.error.index <= input.length);
      assert(typeof res.error.message === "string");
      assert(res.error.message.length > 0);
    }
  }
});

Deno.test("fuzz: evaluateExpression never throws in non-throwing mode", () => {
  const seed = 0xBADC0DE;
  const rng = mulberry32(seed);

  const env = {
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
    status: "open",
    priority: 4,
  };

  for (let i = 0; i < 1_000; i++) {
    const input = genExpr(rng);

    let res;
    try {
      res = evaluateExpression(input, {
        env,
        throwOnError: false,
        throwOnParseError: false,
        // Keep fuzz runs bounded.
        maxSteps: 2_000,
        maxDepth: 64,
        maxArrayElements: 100,
        // Avoid spending a bunch of time on unknown identifiers.
        unknownIdentifier: "undefined",
      });
    } catch (err) {
      throw new Error(
        `evaluateExpression threw (seed=${seed}, i=${i}, input=${
          JSON.stringify(input)
        }): ${String(err)}`,
      );
    }

    if (!res.success) {
      assert(typeof res.error.message === "string");
      assert(res.error.message.length > 0);
      if (res.error.index !== undefined) {
        assert(res.error.index >= 0);
        assert(res.error.index <= input.length);
      }
      if (res.error.steps !== undefined) {
        assert(res.error.steps >= 0);
      }
    }
  }
});
