import {
  any,
  chainl1,
  createLanguage,
  createLexer,
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

export type ParseOptions = Readonly<{
  /** When true, throw on parse failure. Default: true */
  throwOnError?: boolean;
}>;

export type ParseError = Readonly<{
  message: string;
  index: number;
}>;

export type ParseResult =
  | Readonly<{ success: true; value: Expr }>
  | Readonly<{ success: false; error: ParseError }>;

export class ExpParseError extends Error {
  readonly index: number;

  constructor(error: ParseError) {
    super(error.message);
    this.name = "ExpParseError";
    this.index = error.index;
  }
}

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

const RESERVED = new Set(["true", "false", "null"]);

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
  Expression: Parser<Expr>;
  Conditional: Parser<Expr>;
  Pipeline: Parser<Expr>;
  LogicalOr: Parser<Expr>;
  LogicalAnd: Parser<Expr>;
  Equality: Parser<Expr>;
  Comparison: Parser<Expr>;
  Additive: Parser<Expr>;
  Multiplicative: Parser<Expr>;
  Unary: Parser<Expr>;
  Postfix: Parser<Expr>;
  Primary: Parser<Expr>;
  File: Parser<Expr>;
}>;

const ExpressionLang: ExprLang = createLanguage<ExprLang>({
  Expression: (s) => s.Conditional,

  Conditional: (s) => {
    const q = lx.symbol("?");
    const colon = lx.symbol(":");
    return map(
      seq(s.Pipeline, optional(seq(q, s.Expression, colon, s.Expression))),
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

    return map(seq(s.LogicalOr, many(seq(op, s.Postfix))), ([first, rest]) => {
      return rest.reduce(
        (acc, [, rhs]) => mkPipedCall(acc.span.start, rhs, acc),
        first,
      );
    });
  },

  LogicalOr: (s) => {
    const op = lx.symbol("||");
    return chainl1(s.LogicalAnd, op, (l, _op, r) => mkBinary(l, "||", r));
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
    const memberOp = map(seq(lx.symbol("."), identSpan), ([, prop]) => {
      return (obj: Expr): Expr => mkMember(obj, prop);
    });

    const args = map(
      sepBy(s.Expression, comma),
      (xs) => xs.filter((x): x is Expr => typeof x !== "string"),
    );

    const callOp = map(seq(lparen, args, rparen), ([, args, end]) => {
      return (callee: Expr): Expr => mkCall(callee, args, end);
    });

    const op = any(memberOp, callOp);
    return map(seq(s.Primary, many(op)), ([base, ops]) => {
      return ops.reduce((acc, fn) => fn(acc), base);
    });
  },

  Primary: (s) => {
    const kwTrue = keyword("true");
    const kwFalse = keyword("false");
    const kwNull = keyword("null");

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
        map(
          sepBy(s.Expression, comma),
          (xs) => xs.filter((x): x is Expr => typeof x !== "string"),
        ),
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

    return any(
      arrayExpr,
      boolExpr,
      nullExpr,
      numExpr,
      strExpr,
      parenExpr,
      identExpr,
    );
  },

  File: (s) => map(seq(lx.trivia, s.Expression, eof()), ([, e]) => e),
});

/** Parse a single expression. */
export function parseExpression(
  input: string,
  opts: ParseOptions = {},
): ParseResult {
  const throwOnError = opts.throwOnError ?? true;

  const res = ExpressionLang.File({ text: input, index: 0 });
  if (res.success) {
    return { success: true, value: res.value };
  }

  const message = formatErrorCompact(res);
  const err: ParseError = { message, index: res.ctx.index };
  if (throwOnError) {
    throw new ExpParseError(err);
  }
  return { success: false, error: err };
}
