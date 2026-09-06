import { evaluateExpression } from "jsr:@claudiu-ceia/exp";
import "../examples/readme.test.ts";

const result = evaluateExpression(
  'account.plan == "pro" && usage.requests >= 1000',
  {
    env: {
      account: { plan: "pro" },
      usage: { requests: 1400 },
    },
    throwOnParseError: false,
    throwOnError: false,
  },
);

if (!result.success || result.value !== true) {
  throw new Error("JSR source import did not evaluate the README filter");
}

console.log("JSR source import passed");
