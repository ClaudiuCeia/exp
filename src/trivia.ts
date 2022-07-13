import {
  either,
  manyTill,
  oneOf,
  space,
  str,
  surrounded,
  anyChar,
  peek,
  peekAnd,
  eol,
  map,
} from "https://deno.land/x/combine@v0.0.2/mod.ts";

/**
 * SyntaxKind.Trivia
 *
 * Any code that's not relevant for the program (whitespace, comments)
 */
export const spaceTrivia = space();

export const commentTrivia = either(
  surrounded(
    str("/*"),
    map(manyTill(anyChar(), peek(str("*/"))), (v) =>
      v.filter((m) => m !== null).join("")
    ),
    str("*/")
  ),
  peekAnd(str("//"), manyTill(anyChar(), eol()))
);

export const trivia = oneOf(spaceTrivia, commentTrivia /* terminalTrivia */);
