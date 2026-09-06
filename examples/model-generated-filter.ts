import { evaluateExpression } from "@claudiu-ceia/exp";

const generated = 'ticket.priority >= 3 && ticket.status == "open"';

export const generatedResult = evaluateExpression(generated, {
  env: {
    ticket: {
      priority: 4,
      status: "open",
    },
  },
  throwOnParseError: false,
  throwOnError: false,
});

export const generatedFilterAccepted =
  generatedResult.success && generatedResult.value === true;
