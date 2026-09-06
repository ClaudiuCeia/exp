import { evaluateExpression } from "@claudiu-ceia/exp";

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

if (!result.success) {
  console.error(result.error);
} else {
  console.log(result.value); // true
}

const matches = result.success && result.value === true;

export { matches, result };
