import {
  any,
  map,
  number,
  oneOf,
  str,
  signed,
  double,
  surrounded,
  manyTill,
  anyChar,
  peek,
Parser,
sepBy,
skip1,
} from "https://deno.land/x/combine@v0.0.2/mod.ts";
import { ArrayLiteralExpression } from "./ast/ArrayLiteralExpression.ts";
import { FalseKeyword } from "./ast/FalseKeyword.ts";
import { FloatLiteral } from "./ast/FloatLiteral.ts";
import { IntLiteral } from "./ast/IntLiteral.ts";
import { Node } from "./ast/Node.ts";
import { NullKeyword } from "./ast/NullKeyword.ts";
import { StringLiteral } from "./ast/StringLiteral.ts";
import { TrueKeyword } from "./ast/TrueKeyword.ts";
import { comma } from "./atom.ts";
import { terminated } from "./combinators.ts";

export type Literal = string | null | number | boolean;
export type LiteralNode = Node<Literal>;
export type BinaryExpressionNode = Node<
  [
    LiteralNode | BinaryExpressionNode,
    Node<string>,
    LiteralNode | BinaryExpressionNode
  ]
>;

export const boolLiteral = map(
  terminated(oneOf(str("true"), str("false"))),
  (v, b, a) =>
    v === "true" ? new TrueKeyword(true, b, a) : new FalseKeyword(false, b, a)
);

export const intLiteral = map(
  terminated(any(number(), signed())),
  (...args) => new IntLiteral(...args)
);

export const floatLiteral = map(
  terminated(oneOf(double(), signed(double()))),
  (...args) => new FloatLiteral(...args)
);

export const stringLiteral = map(
  terminated(
    oneOf(
      surrounded(
        str('"'),
        map(manyTill(anyChar(), peek(str('"'))), (m) =>
          m.slice(0, -1).join("")
        ),
        str('"')
      ),
      surrounded(
        str("'"),
        map(manyTill(anyChar(), peek(str("'"))), (m) => {
          return m.slice(0, -1).join("");
        }),
        str("'")
      ),
      surrounded(
        str('"""'),
        map(manyTill(anyChar(), peek(str('"""'))), (m) =>
          m.slice(0, -1).join("")
        ),
        str('""""')
      )
    )
  ),
  (...args) => new StringLiteral(...args)
);

export const nullLiteral = map(
  terminated(str("null")),
  (_v, ...rest) => new NullKeyword(null, ...rest)
);

export const listLiteral = <T>(p: Parser<T>) =>
  map(
    surrounded(
      terminated(str("[")),
      map(sepBy(terminated(p), skip1(comma)), (m) =>
        m.filter((v) => v !== null)
      ),
      terminated(str("]"))
    ),
    (...args) => new ArrayLiteralExpression(...args)
  );

export const literal = any<Node>(
  floatLiteral,
  intLiteral,
  boolLiteral,
  nullLiteral,
  stringLiteral
);
