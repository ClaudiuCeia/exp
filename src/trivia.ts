import {
  anyChar,
  either,
  eol,
  manyTill,
  map,
  oneOf,
  peek,
  peekAnd,
  space,
  str,
  surrounded,
} from "https://deno.land/x/combine@v0.0.9/mod.ts";

/**
 * SyntaxKind.Trivia
 *
 * Any code that's not relevant for the program (whitespace, comments)
 */
export const spaceTrivia = space();

export const commentTrivia = either(
  surrounded(
    str("/*"),
    map(
      manyTill(anyChar(), peek(str("*/"))),
      (v) => v.filter((m) => m !== null).join(""),
    ),
    str("*/"),
  ),
  peekAnd(str("//"), manyTill(anyChar(), eol())),
);

export const trivia = oneOf(spaceTrivia, commentTrivia /* terminalTrivia */);
