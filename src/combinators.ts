import {
  map,
  Parser,
  seq,
  seqNonNull,
  skipMany,
  space,
} from "https://deno.land/x/combine@v0.0.9/mod.ts";
import { createNode } from "./ast/createNode.ts";
import { Node } from "./ast/Node.ts";
import { SyntaxKind } from "./ast/SyntaxKind.ts";
import { trivia } from "./trivia.ts";

/**
 * @param parser self-explanatory
 * @returns A parser that also consumes any following whitespace.
 * This is more efficient than consuming whitespace first since it avoids
 * backtracking.
 */
export const trailingSpace = <T>(parser: Parser<T>): Parser<T> =>
  map(seq(parser, skipMany(space())), ([m]) => m);

/**
 * @param parser self-explanatory
 * @returns A parser that also consumes any following trivia. This is more
 * efficient than consuming trivia leading up to the parser since it avoids
 * backtracking.
 */
export const terminated = <T>(parser: Parser<T>): Parser<T> =>
  map(seqNonNull(parser, skipMany(trivia)), ([m]) => m);

/**
 * @param kind What kind of an AST node that does this parser parse?
 * @param transformer This allows you to remap the parser result to something
 * more suitable for the AST (ie: map binary expression results to a left/right
 * structure)
 * @returns A parser that transforms the result of the input parser to an AST node
 * of your choosing.
 */
export const toAST = (
  kind: SyntaxKind,
  parser: Parser<unknown>,
): Parser<Node<unknown>> => map(parser, createNode(kind));
