import { any, map, str } from "https://deno.land/x/combine@v0.0.9/mod.ts";
import { AmpersandAmpersandToken } from "./ast/AmpersandAmpersandToken.ts";
import { AsteriskToken } from "./ast/AsteriskToken.ts";
import { BarBarToken } from "./ast/BarBarToken.ts";
import { EqualsEqualsToken } from "./ast/EqualsEqualsToken.ts";
import { ExclamationEqualsToken } from "./ast/ExclamationEqualsToken.ts";
import { GreaterThanOrEqualToken } from "./ast/GreaterThanOrEqualToken.ts";
import { GreaterThanToken } from "./ast/GreaterThanToken.ts";
import { InKeyword } from "./ast/InKeyword.ts";
import { LessThanOrEqualToken } from "./ast/LessThanOrEqualToken.ts";
import { LessThanToken } from "./ast/LessThanToken.ts";
import { MinusToken } from "./ast/MinusToken.ts";
import { PercentToken } from "./ast/PercentToken.ts";
import { PlusEqualsToken } from "./ast/PlusEqualsToken.ts";
import { PlusToken } from "./ast/PlusToken.ts";
import { SlashToken } from "./ast/SlashToken.ts";
import { terminated } from "./combinators.ts";

export const relOperator = any(
  map(terminated(str("<=")), (...args) => new LessThanOrEqualToken(...args)),
  map(terminated(str("<")), (...args) => new LessThanToken(...args)),
  map(terminated(str(">=")), (...args) => new GreaterThanOrEqualToken(...args)),
  map(terminated(str(">")), (...args) => new GreaterThanToken(...args)),
  map(terminated(str("==")), (...args) => new EqualsEqualsToken(...args)),
  map(terminated(str("!=")), (...args) => new ExclamationEqualsToken(...args)),
  map(terminated(str("in")), (...args) => new InKeyword(...args)),
);

export const logicalOr = map(
  terminated(str("||")),
  (...args) => new BarBarToken(...args),
);

export const logicalAnd = map(
  terminated(str("&&")),
  (...args) => new AmpersandAmpersandToken(...args),
);

export const plusOp = map(
  terminated(str("+")),
  (...args) => new PlusToken(...args),
);
export const minusOp = map(
  terminated(str("-")),
  (...args) => new MinusToken(...args),
);

export const mulOp = map(
  terminated(str("*")),
  (...args) => new AsteriskToken(...args),
);

export const divOp = map(
  terminated(str("/")),
  (...args) => new SlashToken(...args),
);

export const modOp = map(
  terminated(str("%")),
  (...args) => new PercentToken(...args),
);

export const plusEq = map(
  terminated(str("+=")),
  (...args) => new PlusEqualsToken(...args),
);
