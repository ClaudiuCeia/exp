import { parseExpression } from "../src/parse.ts";

const SIMPLE = "status == 'open' && priority >= 3";

const COMPLEX_RULE = `(
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

Deno.bench("parse: simple filter", () => {
  parseExpression(SIMPLE);
});

Deno.bench("parse: complex rule", () => {
  parseExpression(COMPLEX_RULE);
});
