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
  type BinaryOp,
  type Expr,
  mkBinary,
  mkCall,
  mkMember,
  mkUnary,
  type UnaryOp,
} from "./ast/mod.ts";
import { createStringSpan } from "./string_literal.ts";

/** Options for `parseExpression`. */
export type ParseOptions = Readonly<{
  /** When true, throw on parse failure. Default: true */
  throwOnError?: boolean;
  /** Maximum input length in UTF-16 code units. Default: 100,000. */
  maxInputLength?: number;
  /** Maximum recursive syntax nesting. Default: 64. */
  maxNestingDepth?: number;
  /** Maximum number of nodes in the parsed AST. Default: 10,000. */
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
 * Carries the byte `index` into the original input.
 */
export class ExpParseError extends Error {
  /** Byte index into the input string where parsing failed. */
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

type ExprLang = Readonly<{
  Expression: Expr;
  Conditional: Expr;
  Pipeline: Expr;
  LogicalOr: Expr;
  LogicalAnd: Expr;
  Equality: Expr;
  Comparison: Expr;
  Additive: Expr;
  Multiplicative: Expr;
  Unary: Expr;
  Postfix: Expr;
  Primary: Expr;
  File: Expr;
}>;

const ExpressionLang = defineLanguage<ExprLang>({
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
        return {
          kind: "call",
          callee: rhs.callee,
          args: [lhs, ...rhs.args],
          span: { start, end: rhs.span.end },
        };
      }

      return {
        kind: "call",
        callee: rhs,
        args: [lhs],
        span: { start, end: rhs.span.end },
      };
    };

    return map(
      seq(s.LogicalOr, many(seq(op, cut(s.Postfix, "expression after '|>'")))),
      ([first, rest]) => {
        return rest.reduce(
          (acc, [, rhs]) => mkPipedCall(acc.span.start, rhs, acc),
          first,
        );
      },
    );
  },

  LogicalOr: (s) => {
    const op = any(lx.symbol("||"), lx.symbol("??"));
    return chainl1(
      s.LogicalAnd,
      op,
      (l, o, r) => mkBinary(l, o as BinaryOp, r),
    );
  },

  LogicalAnd: (s) => {
    const op = lx.symbol("&&");
    return chainl1(s.Equality, op, (l, _op, r) => mkBinary(l, "&&", r));
  },

  Equality: (s) => {
    const op = any(lx.symbol("=="), lx.symbol("!="));
    return chainl1(
      s.Comparison,
      op,
      (l, o, r) => mkBinary(l, o as BinaryOp, r),
    );
  },

  Comparison: (s) => {
    const op = any(
      lx.symbol("<="),
      lx.symbol(">="),
      lx.symbol("<"),
      lx.symbol(">"),
    );
    return chainl1(s.Additive, op, (l, o, r) => mkBinary(l, o as BinaryOp, r));
  },

  Additive: (s) => {
    const op = any(lx.symbol("+"), lx.symbol("-"));
    return chainl1(
      s.Multiplicative,
      op,
      (l, o, r) => mkBinary(l, o as BinaryOp, r),
    );
  },

  Multiplicative: (s) => {
    const op = any(lx.symbol("*"), lx.symbol("/"), lx.symbol("%"));
    return chainl1(s.Unary, op, (l, o, r) => mkBinary(l, o as BinaryOp, r));
  },

  Unary: (s) => {
    const op = lx.lexeme(
      map(
        withSpan(any(str("!"), str("-"), str("+"))),
        ({ value, start }) => ({ op: value as UnaryOp, start }),
      ),
    );

    return map(seq(many(op), s.Postfix), ([ops, expr]) => {
      let acc = expr;
      for (let i = ops.length - 1; i >= 0; i--) {
        const o = ops[i]!;
        acc = mkUnary(o.op, o.start, acc);
      }
      return acc;
    });
  },

  Postfix: (s) => {
    const memberOp = map(
      seq(lx.symbol("."), cut(identSpan, "identifier after '.'")),
      ([, prop]) => {
        return (obj: Expr): Expr => mkMember(obj, prop);
      },
    );

    const args = sepBy(s.Expression, comma);

    const callOp = map(
      seq(lparen, args, cut(rparen, "closing ')'")),
      ([, args, end]) => {
        return (callee: Expr): Expr => mkCall(callee, args, end);
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
      map(kwTrue, (t) => ({
        kind: "boolean",
        value: true,
        span: { start: t.start, end: t.end },
      } satisfies Expr)),
      map(kwFalse, (f) => ({
        kind: "boolean",
        value: false,
        span: { start: f.start, end: f.end },
      } satisfies Expr)),
    );

    const nullExpr: Parser<Expr> = map(kwNull, (n) => ({
      kind: "null",
      span: { start: n.start, end: n.end },
    } satisfies Expr));

    const undefinedExpr: Parser<Expr> = map(kwUndefined, (u) => ({
      kind: "undefined",
      span: { start: u.start, end: u.end },
    } satisfies Expr));

    const numExpr: Parser<Expr> = map(numberSpan, (n) => ({
      kind: "number",
      value: n.value,
      span: { start: n.start, end: n.end },
    } satisfies Expr));

    const strExpr: Parser<Expr> = map(stringSpan, (st) => ({
      kind: "string",
      value: st.value,
      span: { start: st.start, end: st.end },
    } satisfies Expr));

    const identExpr: Parser<Expr> = map(
      guard(identSpan, (id) => !RESERVED.has(id.value), "identifier"),
      (id) => ({
        kind: "identifier",
        name: id.value,
        span: { start: id.start, end: id.end },
      } satisfies Expr),
    );

    const arrayExpr: Parser<Expr> = map(
      seq(
        lbrack,
        sepBy(s.Expression, comma),
        rbrack,
      ),
      ([start, elements, end]) => ({
        kind: "array",
        elements,
        span: { start, end },
      } satisfies Expr),
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
  const frames: Array<{ delimiter: "(" | "[" | null; conditionals: number }> = [
    { delimiter: null, conditionals: 0 },
  ];
  let quote: "'" | '"' | null = null;

  const depth = () => {
    let conditionals = 0;
    for (const frame of frames) conditionals += frame.conditionals;
    return frames.length - 1 + conditionals;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (ch === "(" || ch === "[") {
      frames.push({ delimiter: ch, conditionals: 0 });
    } else if (
      (ch === ")" && frames[frames.length - 1].delimiter === "(") ||
      (ch === "]" && frames[frames.length - 1].delimiter === "[")
    ) {
      frames.pop();
    } else if (ch === ",") {
      frames[frames.length - 1].conditionals = 0;
    } else if (ch === "?" && input[i + 1] !== "?") {
      frames[frames.length - 1].conditionals++;
    } else if (ch === "?" && input[i + 1] === "?") {
      i++;
    }

    if (depth() > maxNestingDepth) {
      return { message: "parse nesting limit exceeded", index: i };
    }
  }

  return null;
};

const checkNodeLimit = (root: Expr, maxNodes: number): ParseError | null => {
  const pending: Expr[] = [root];
  let count = 0;

  while (pending.length > 0) {
    const node = pending.pop()!;
    count++;
    if (count > maxNodes) {
      return { message: "AST node limit exceeded", index: node.span.start };
    }

    switch (node.kind) {
      case "array":
        for (const element of node.elements) pending.push(element);
        break;
      case "unary":
        pending.push(node.expr);
        break;
      case "binary":
        pending.push(node.right, node.left);
        break;
      case "member":
        pending.push(node.object);
        break;
      case "call":
        pending.push(node.callee);
        for (const arg of node.args) pending.push(arg);
        break;
      case "conditional":
        pending.push(node.alternate, node.consequent, node.test);
        break;
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

  let res: ReturnType<typeof ExpressionLang.File>;
  try {
    res = ExpressionLang.File({ text: input, index: 0 });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return parseFailure(
      { message: "parser recursion limit exceeded", index: 0 },
      throwOnError,
    );
  }
  if (res.success) {
    const nodeError = checkNodeLimit(res.value, maxNodes);
    if (nodeError) return parseFailure(nodeError, throwOnError);
    return { success: true, value: res.value };
  }

  const message = formatErrorCompact(res);
  const err: ParseError = { message, index: res.ctx.index };
  return parseFailure(err, throwOnError);
}
