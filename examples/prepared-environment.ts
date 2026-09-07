import { evaluateExpression, prepareEnvironment } from "@claudiu-ceia/exp";

export const preparedEnvironment = prepareEnvironment({
  account: { plan: "pro" },
  usage: { requests: 1_400 },
});

export const preparedPlanResult = evaluateExpression('account.plan == "pro"', {
  env: preparedEnvironment,
  throwOnError: false,
  throwOnParseError: false,
});

export const preparedUsageResult = evaluateExpression(
  "usage.requests >= 1000",
  {
    env: preparedEnvironment,
    throwOnError: false,
    throwOnParseError: false,
  },
);
