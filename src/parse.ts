import {
  any,
  chainl1,
  createLexer,
  cut,
  defineLanguage,
  eof,
  failure,
  formatErrorCompact,
  many,
  map,
  not,
  number,
  optional,
  type Parser,
  regex,
  sepBy,
  seq,
  str,
  withSpan,
} from "@claudiu-ceia/combine";
import {
  BINARY_OPERATOR_GROUPS,
  type Expr,
  mkBinary,
  mkCall,
  mkMember,
  mkUnary,
  UNARY_OPERATORS,
} from "./ast/mod.ts";
import { createStringSpan } from "./string_literal.ts";

/** Options for `parseExpression`. */
export type ParseOptions = Readonly<{
  /** When true, throw on parse failure. Default: true */
  throwOnError?: boolean;
  /** Maximum input length in UTF-16 code units. Default: 100,000. */
  maxInputLength?: number;
  /** Maximum recursive syntax nesting outside strings and comments. Default: 64. */
  maxNestingDepth?: number;
  /** Maximum AST node allocations during parsing, including transient nodes. Default: 10,000. */
  maxNodes?: number;
}>;

const DEFAULT_MAX_INPUT_LENGTH = 100_000;
const DEFAULT_MAX_NESTING_DEPTH = 64;
const DEFAULT_MAX_NODES = 10_000;

/**
 * A parse failure.
 *
 * `index` is a UTF-16 code-unit index into the input string.
 */
export type ParseError = Readonly<{
  message: string;
  index: number;
}>;

/** Result of `parseExpression`. */
export type ParseResult =
  | Readonly<{ success: true; value: Expr }>
  | Readonly<{ success: false; error: ParseError }>;

/**
 * Thrown parse error (default mode).
 *
 * Carries the UTF-16 code-unit `index` into the original input.
 */
export class ExpParseError extends Error {
  /** UTF-16 code-unit index into the input string where parsing failed. */
  readonly index: number;

  /** Create an `ExpParseError` from a `ParseError` payload. */
  constructor(error: ParseError) {
    super(error.message);
    this.name = "ExpParseError";
    this.index = error.index;
  }
}

const expecting = <T>(parser: Parser<T>, expected: string): Parser<T> => {
  return (ctx) => {
    const res = parser(ctx);
    if (res.success) return res;

    // Only override when the parser didn't advance.
    // This avoids turning useful errors (like missing ')') into generic ones.
    if (res.ctx.index !== ctx.index) return res;
    if (res.fatal) return res;

    return { ...res, expected };
  };
};

const guard = <T>(
  p: Parser<T>,
  pred: (value: T) => boolean,
  expected: string,
): Parser<T> => {
  return (ctx) => {
    const res = p(ctx);
    if (!res.success) return res;
    return pred(res.value) ? res : failure(ctx, expected);
  };
};

const RESERVED = new Set(["true", "false", "null", "undefined"]);

const lx = createLexer();
const identStartChar = regex(/[_a-zA-Z]/, "identifier start");
const identContinue = regex(/[_a-zA-Z0-9]/, "identifier char");

const keyword = (
  s: string,
): Parser<{ value: string; start: number; end: number }> => {
  const raw = map(seq(str(s), not(identContinue)), ([kw]) => kw);
  return lx.lexeme(
    map(withSpan(raw), ({ value, start, end }) => ({ value, start, end })),
  );
};

const identSpan = lx.lexeme(
  map(
    withSpan(
      map(
        seq(identStartChar, many(identContinue)),
        ([first, rest]) => first + rest.join(""),
      ),
    ),
    ({ value, start, end }) => ({ value, start, end }),
  ),
);

const stringSpan = createStringSpan(lx);

const numberSpan = lx.lexeme(
  map(withSpan(number()), ({ value, start, end }) => ({ value, start, end })),
);

const lparen = lx.lexeme(map(withSpan(str("(")), ({ start }) => start));
const rparen = lx.lexeme(map(withSpan(str(")")), ({ end }) => end));

const lbrack = lx.lexeme(map(withSpan(str("[")), ({ start }) => start));
const rbrack = lx.lexeme(map(withSpan(str("]")), ({ end }) => end));

const comma = lx.symbol(",");

type OperatorList = readonly [string, ...string[]];

const operatorParser = <const Operators extends OperatorList>(
  operators: Operators,
): Parser<Operators[number]> => {
  const parsers: Parser<Operators[number]>[] = [];
  for (const operator of operators) {
    parsers.push(map(lx.symbol(operator), () => operator));
  }
  return any(...parsers);
};

type ExprLang = Readonly<{
  Expression: Expr;
  Conditional: Expr;
  Pipeline: Expr;
  Binary: Expr;
  Unary: Expr;
  Postfix: Expr;
  Primary: Expr;
  File: Expr;
}>;

class AstNodeBudgetExceeded extends Error {
  readonly index: number;

  constructor(index: number) {
    super("AST node limit exceeded");
    this.name = "AstNodeBudgetExceeded";
    this.index = index;
  }
}

class AstNodeBudget {
  #remaining: number;

  constructor(maxNodes: number) {
    this.#remaining = maxNodes;
  }

  consume(index: number): void {
    if (this.#remaining === 0) throw new AstNodeBudgetExceeded(index);
    this.#remaining--;
  }

  setRemaining(maxNodes: number): number {
    const previous = this.#remaining;
    this.#remaining = maxNodes;
    return previous;
  }
}

const createExpressionLanguage = (budget: AstNodeBudget) =>
  defineLanguage<ExprLang>({
    Expression: (s) => s.Conditional,

    Conditional: (s) => {
      const q = lx.symbol("?");
      const colon = lx.symbol(":");
      return map(
        seq(
          s.Pipeline,
          optional(
            seq(
              q,
              cut(s.Expression, "expression after '?'"),
              cut(colon, "':' in conditional expression"),
              cut(s.Expression, "expression after ':'"),
            ),
          ),
        ),
        ([test, rest]) => {
          if (!rest) return test;
          const [, consequent, , alternate] = rest;
          budget.consume(test.span.start);
          return {
            kind: "conditional",
            test,
            consequent,
            alternate,
            span: { start: test.span.start, end: alternate.span.end },
          };
        },
      );
    },

    Pipeline: (s) => {
      const op = lx.symbol("|>");

      const mkPipedCall = (start: number, rhs: Expr, lhs: Expr): Expr => {
        if (rhs.kind === "call") {
          budget.consume(start);
          return {
            kind: "call",
            callee: rhs.callee,
            args: [lhs, ...rhs.args],
            span: { start, end: rhs.span.end },
          };
        }

        budget.consume(start);
        return {
          kind: "call",
          callee: rhs,
          args: [lhs],
          span: { start, end: rhs.span.end },
        };
      };

      return map(
        seq(s.Binary, many(seq(op, cut(s.Postfix, "expression after '|>'")))),
        ([first, rest]) => {
          return rest.reduce(
            (acc, [, rhs]) => mkPipedCall(acc.span.start, rhs, acc),
            first,
          );
        },
      );
    },

    Binary: (s) => {
      let parser: Parser<Expr> = s.Unary;
      for (let index = BINARY_OPERATOR_GROUPS.length - 1; index >= 0; index--) {
        const operators = BINARY_OPERATOR_GROUPS[index];
        if (operators === undefined) {
          throw new Error("binary operator group is missing");
        }
        parser = chainl1(parser, operatorParser(operators), (l, o, r) => {
          budget.consume(l.span.start);
          return mkBinary(l, o, r);
        });
      }
      return parser;
    },

    Unary: (s) => {
      const op = lx.lexeme(
        map(withSpan(operatorParser(UNARY_OPERATORS)), ({ value, start }) => ({
          op: value,
          start,
        })),
      );

      return map(seq(many(op), s.Postfix), ([ops, expr]) => {
        let acc = expr;
        for (let i = ops.length - 1; i >= 0; i--) {
          const o = ops[i];
          budget.consume(o.start);
          acc = mkUnary(o.op, o.start, acc);
        }
        return acc;
      });
    },

    Postfix: (s) => {
      const memberOp = map(
        seq(lx.symbol("."), cut(identSpan, "identifier after '.'")),
        ([, prop]) => {
          return (obj: Expr): Expr => {
            budget.consume(obj.span.start);
            return mkMember(obj, prop);
          };
        },
      );

      const args = sepBy(s.Expression, comma);

      const callOp = map(
        seq(lparen, args, cut(rparen, "closing ')'")),
        ([, args, end]) => {
          return (callee: Expr): Expr => {
            budget.consume(callee.span.start);
            return mkCall(callee, args, end);
          };
        },
      );

      const op = any(memberOp, callOp);
      return map(seq(s.Primary, many(op)), ([base, ops]) => {
        return ops.reduce((acc, fn) => fn(acc), base);
      });
    },

    Primary: (s) => {
      const kwTrue = keyword("true");
      const kwFalse = keyword("false");
      const kwNull = keyword("null");
      const kwUndefined = keyword("undefined");

      const boolExpr: Parser<Expr> = any(
        map(kwTrue, (t) => {
          budget.consume(t.start);
          return {
            kind: "boolean",
            value: true,
            span: { start: t.start, end: t.end },
          } satisfies Expr;
        }),
        map(kwFalse, (f) => {
          budget.consume(f.start);
          return {
            kind: "boolean",
            value: false,
            span: { start: f.start, end: f.end },
          } satisfies Expr;
        }),
      );

      const nullExpr: Parser<Expr> = map(kwNull, (n) => {
        budget.consume(n.start);
        return {
          kind: "null",
          span: { start: n.start, end: n.end },
        } satisfies Expr;
      });

      const undefinedExpr: Parser<Expr> = map(kwUndefined, (u) => {
        budget.consume(u.start);
        return {
          kind: "undefined",
          span: { start: u.start, end: u.end },
        } satisfies Expr;
      });

      const numExpr: Parser<Expr> = map(numberSpan, (n) => {
        budget.consume(n.start);
        return {
          kind: "number",
          value: n.value,
          span: { start: n.start, end: n.end },
        } satisfies Expr;
      });

      const strExpr: Parser<Expr> = map(stringSpan, (st) => {
        budget.consume(st.start);
        return {
          kind: "string",
          value: st.value,
          span: { start: st.start, end: st.end },
        } satisfies Expr;
      });

      const identExpr: Parser<Expr> = map(
        guard(identSpan, (id) => !RESERVED.has(id.value), "identifier"),
        (id) => {
          budget.consume(id.start);
          return {
            kind: "identifier",
            name: id.value,
            span: { start: id.start, end: id.end },
          } satisfies Expr;
        },
      );

      const arrayExpr: Parser<Expr> = map(
        seq(lbrack, sepBy(s.Expression, comma), rbrack),
        ([start, elements, end]) => {
          budget.consume(start);
          return {
            kind: "array",
            elements,
            span: { start, end },
          } satisfies Expr;
        },
      );

      const parenExpr: Parser<Expr> = map(
        seq(lx.symbol("("), s.Expression, lx.symbol(")")),
        ([, e]) => e,
      );

      return expecting(
        any(
          arrayExpr,
          boolExpr,
          nullExpr,
          undefinedExpr,
          numExpr,
          strExpr,
          parenExpr,
          identExpr,
        ),
        "expression",
      );
    },

    File: (s) => map(seq(lx.trivia, s.Expression, eof()), ([, e]) => e),
  });

const astNodeBudget = new AstNodeBudget(0);
const ExpressionLang = createExpressionLanguage(astNodeBudget);

const parseFailure = (
  error: ParseError,
  throwOnError: boolean,
): ParseResult => {
  if (throwOnError) throw new ExpParseError(error);
  return { success: false, error };
};

const readLimit = (
  value: number | undefined,
  fallback: number,
  name: string,
): number | ParseError => {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    return { message: `${name} must be a non-negative safe integer`, index: 0 };
  }
  return limit;
};

const checkNesting = (
  input: string,
  maxNestingDepth: number,
): ParseError | null => {
  type Frame =
    | Readonly<{ delimiter: null; conditionals: number }>
    | Readonly<{
        delimiter: "(" | "[";
        conditionals: number;
        parent: Frame;
      }>;

  let frame: Frame = { delimiter: null, conditionals: 0 };
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && input[i + 1] === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (ch === "/" && input[i + 1] === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && input[i + 1] === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (ch === "(" || ch === "[") {
      frame = { delimiter: ch, conditionals: 0, parent: frame };
      depth++;
    } else if (ch === ")" && frame.delimiter === "(") {
      depth -= frame.conditionals + 1;
      frame = frame.parent;
    } else if (ch === "]" && frame.delimiter === "[") {
      depth -= frame.conditionals + 1;
      frame = frame.parent;
    } else if (ch === ",") {
      depth -= frame.conditionals;
      frame = { ...frame, conditionals: 0 };
    } else if (ch === "?" && input[i + 1] !== "?") {
      depth++;
      frame = { ...frame, conditionals: frame.conditionals + 1 };
    } else if (ch === "?" && input[i + 1] === "?") {
      i++;
    }

    if (depth > maxNestingDepth) {
      return { message: "parse nesting limit exceeded", index: i };
    }
  }

  return null;
};

/**
 * Parse a single expression into an AST.
 *
 * - On success: returns `{ success: true, value }`.
 * - On failure: throws `ExpParseError` by default.
 *   Set `throwOnError: false` to get `{ success: false, error }`.
 */
export function parseExpression(
  input: string,
  opts: ParseOptions = {},
): ParseResult {
  const throwOnError = opts.throwOnError ?? true;

  const maxInputLength = readLimit(
    opts.maxInputLength,
    DEFAULT_MAX_INPUT_LENGTH,
    "maxInputLength",
  );
  if (typeof maxInputLength !== "number") {
    return parseFailure(maxInputLength, throwOnError);
  }
  const maxNestingDepth = readLimit(
    opts.maxNestingDepth,
    DEFAULT_MAX_NESTING_DEPTH,
    "maxNestingDepth",
  );
  if (typeof maxNestingDepth !== "number") {
    return parseFailure(maxNestingDepth, throwOnError);
  }
  const maxNodes = readLimit(opts.maxNodes, DEFAULT_MAX_NODES, "maxNodes");
  if (typeof maxNodes !== "number") {
    return parseFailure(maxNodes, throwOnError);
  }

  if (input.length > maxInputLength) {
    return parseFailure(
      { message: "parse input length limit exceeded", index: maxInputLength },
      throwOnError,
    );
  }

  const nestingError = checkNesting(input, maxNestingDepth);
  if (nestingError) return parseFailure(nestingError, throwOnError);

  const previousRemainingAstNodes = astNodeBudget.setRemaining(maxNodes);
  let res: ReturnType<typeof ExpressionLang.File>;
  try {
    res = ExpressionLang.File({ text: input, index: 0 });
  } catch (error) {
    if (error instanceof AstNodeBudgetExceeded) {
      return parseFailure(
        { message: error.message, index: error.index },
        throwOnError,
      );
    }
    if (!(error instanceof RangeError)) throw error;
    return parseFailure(
      { message: "parser recursion limit exceeded", index: 0 },
      throwOnError,
    );
  } finally {
    astNodeBudget.setRemaining(previousRemainingAstNodes);
  }
  if (res.success) {
    return { success: true, value: res.value };
  }

  const message = formatErrorCompact(res);
  const err: ParseError = { message, index: res.ctx.index };
  return parseFailure(err, throwOnError);
}
