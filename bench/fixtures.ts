import type { Expr } from "../src/ast/mod.ts";
import { parseExpression } from "../src/parse.ts";

export const SIMPLE_EXPRESSION = "status == 'open' && priority >= 3";

export const COMPLEX_EXPRESSION = `(
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

export const SIMPLE_ENV = {
  status: "open",
  priority: 4,
};

export const COMPLEX_ENV = {
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

export function mustParse(input: string): Expr {
  const result = parseExpression(input, { throwOnError: false });
  if (!result.success) throw new Error(result.error.message);
  return result.value;
}
