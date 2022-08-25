import {
  Parser,
  seqNonNull,
  skip1,
  skipMany,
  str,
  surrounded,
} from "https://deno.land/x/combine@v0.0.9/mod.ts";
import { Node } from "./ast/Node.ts";
import { SyntaxKind } from "./ast/SyntaxKind.ts";
import { semiColon } from "./atom.ts";
import { terminated } from "./combinators.ts";
import { trivia } from "./trivia.ts";

export const paren = <T>(parser: Parser<T>): Parser<T> =>
  surrounded(terminated(str("(")), parser, terminated(str(")")));

/**
 * @param p A parser of choice
 * @returns A parser that parses your parser, followed by trivia and a
 * semicolon, and drops the trivia for the return value. Useful for
 * defining statement parsers.
 */
export const semiColonDelimited = <T>(
  p: Parser<Node<T>>,
): Parser<Node<unknown>[]> => {
  return terminated(seqNonNull(p, skipMany(trivia), skip1(semiColon)));
};

export const kindName = (code: SyntaxKind) => {
  const pair = Object.entries(SyntaxKind).find(([_k, v]) => v === code);
  return pair ? pair[0] : undefined;
};
