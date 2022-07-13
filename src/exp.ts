import {
  any,
  either,
  lazy,
  map,
  Parser,
  regex,
  seq,
  str,
  peekAnd,
  sepBy1,
  keepNonNull,
  sepBy,
  skip1,
  many1,
  seqNonNull,
  not,
  peek,
} from "https://deno.land/x/combine@v0.0.2/mod.ts";
import { AsteriskToken } from "./ast/AsteriskToken.ts";
import { BinaryExpression } from "./ast/BinaryExpression.ts";
import { CallExpression } from "./ast/CallExpression.ts";
import { ConditionalExpression } from "./ast/ConditionalExpression.ts";
import { Identifier } from "./ast/Identifier.ts";
import { MinusToken } from "./ast/MinusToken.ts";
import { Node } from "./ast/Node.ts";
import { PercentToken } from "./ast/PercentToken.ts";
import { PlusEqualsToken } from "./ast/PlusEqualsToken.ts";
import { PlusToken } from "./ast/PlusToken.ts";
import { PropertyAccessExpression } from "./ast/PropertyAccessExpression.ts";
import { SlashToken } from "./ast/SlashToken.ts";
import { comma, doubleColon, questionMark } from "./atom.ts";
import { terminated } from "./combinators.ts";
import { paren } from "./common.ts";
/* import {
  breakKeyword,
  continueKeyword,
  elseKeyword,
  fnKeyword,
  forKeyword,
  ifKeyword,
  letKeyword,
  returnKeyword,
} from "./keyword.ts"; */
import {
  listLiteral,
  literal /* , boolLiteral, nullLiteral */,
} from "./literal.ts";
import {
  divOp,
  logicalAnd,
  logicalOr,
  minusOp,
  modOp,
  mulOp,
  plusEq,
  plusOp,
  relOperator,
} from "./operator.ts";

/* const reserved = any<any>(
  boolLiteral,
  nullLiteral,
  elseKeyword,
  forKeyword,
  fnKeyword,
  ifKeyword,
  letKeyword,
  returnKeyword,
  breakKeyword,
  continueKeyword
); */

const identRegex =
  /(?!true|false|null|if|else|for|function|let|return)([_a-zA-Z][_a-zA-Z0-9]*)/;

const ident = map(
  terminated(regex(identRegex, "Expected identifier")),
  (...args) => new Identifier(...args)
);

const unary = (): Parser<Node> =>
  any(
    ident,
    literal,
    listLiteral(
      any(
        literal,
        ident,
        peekAnd(seq(ident, either(str("("), str("."))), lazy(methodCall))
      )
    )
  );

const propertyAccessExpression = map(
  sepBy1(ident, str(".")),
  (v, ...rest) =>
    new PropertyAccessExpression(
      v.filter((m) => m instanceof Identifier),
      ...rest
    )
);

const memberAccess = () => {
    // maybe `furthest`
    return any(propertyAccessExpression, unary());
}

const methodArguments = (): Parser<Node[]> =>
  keepNonNull(
    sepBy(
      any(
        peekAnd(seq(ident, either(str("("), str("."))), lazy(methodCall)),
        unary(),
        lazy(exp)
      ),
      skip1(comma)
    )
  ) as Parser<Node[]>;

const methodCall = () =>
  terminated(
    any(
      map(
        seqNonNull<Node<unknown> | Node<unknown>[]>(
          memberAccess(),
          peekAnd(str("("), paren(methodArguments()))
        ),
        (v, ...rest) => new CallExpression(v, ...rest)
      ),
      memberAccess()
    )
  );

const factor = () =>
  any<Node<unknown>>(
    methodCall(),
    peekAnd(
      terminated(str("(")),
      seqNonNull(
        skip1(terminated(str("("))),
        lazy(exp),
        skip1(terminated(str(")")))
      )
    ) as unknown as Parser<Node<unknown>>
  );

const term = () => {
  const binaryLeft = many1(
    seq(
      any<AsteriskToken | SlashToken | PercentToken>(mulOp, divOp, modOp),
      factor()
    )
  );

  const binary = map(
    seq(factor(), binaryLeft),
    (v, ...rest) => new BinaryExpression(v, ...rest)
  );

  const justFactor = map(seq(factor(), peek(not(binaryLeft))), ([f]) => f);
  return any(justFactor, binary);
};

export const arith = () => {
  const binaryLeft = many1(
    seq(
      any<PlusToken | MinusToken | PlusEqualsToken>(
        plusEq,
        plusOp,
        minusOp,
      ),
      term()
    )
  );

  const binary = map(
    seq(term(), binaryLeft),
    (v, ...rest) => new BinaryExpression(v, ...rest)
  );

  const justTerm = map(seq(term(), peek(not(binaryLeft))), ([t]) => t);
  return any(justTerm, binary);
};

const relation = () => {
  const binaryLeft = many1(seq(relOperator, arith()));
  const binary = map(
    seq(arith(), binaryLeft),
    (v, ...rest) => new BinaryExpression(v, ...rest)
  );
  const justArith = map(seq(arith(), peek(not(binaryLeft))), ([ar]) => ar);
  return any(justArith, binary);
};

const booleanAnd = () => {
  const relationalLeft = many1(seq(logicalAnd, relation()));

  const relational = map(
    seq(relation(), relationalLeft),
    (v, ...rest) => new BinaryExpression(v, ...rest)
  );

  const justRelation = map(
    seq(relation(), peek(not(relationalLeft))),
    ([rel]) => rel
  );

  return any(justRelation, relational);
};

const booleanOr = () => {
  const logicalLeft = many1(seq(logicalOr, booleanAnd()));

  const logical = map(
    seq(booleanAnd(), logicalLeft),
    (v, ...rest) => new BinaryExpression(v, ...rest)
  );

  const justBoolean = map(
    seq(booleanAnd(), peek(not(logicalLeft))),
    ([and]) => and
  );

  return any(justBoolean, logical);
};

// TODO: Support nested ternary expressions
const ternary = () => {
  const conditionalLeft = many1(
    seq(questionMark, booleanOr(), doubleColon, booleanOr())
  );

  const conditional = map(
    seq(booleanOr(), conditionalLeft),
    (...args) => new ConditionalExpression(...args)
  );

  const justBoolean = map(
    seq(booleanOr(), peek(not(conditionalLeft))),
    ([or]) => or
  );

  return any(justBoolean, conditional);
};

export function exp(): Parser<Node<unknown>> {
  return ternary();
}
