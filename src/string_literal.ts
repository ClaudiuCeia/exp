import {
  any,
  cut,
  digit,
  failure,
  hexDigit,
  many,
  map,
  not,
  optional,
  type Parser,
  regex,
  repeat,
  seq,
  str,
  success,
  type WithSpan,
  withSpan,
} from "@claudiu-ceia/combine";

export type Lexer = Readonly<{
  lexeme: <T>(p: Parser<T>) => Parser<T>;
}>;

export type StringSpan = Readonly<
  { value: string; start: number; end: number }
>;

/**
 * String literal parsing aims to match ECMAScript (strict mode) escape semantics.
 *
 * Spec references (ECMA-262):
 * - String literals: https://tc39.es/ecma262/#sec-string-literals
 * - Escape sequences (incl. line continuations): https://tc39.es/ecma262/#prod-EscapeSequence
 * - Unicode escapes (\\uXXXX and \\u{...}): https://tc39.es/ecma262/#prod-UnicodeEscapeSequence
 *
 * Notes:
 * - In strict mode, legacy octal escapes are SyntaxError; we model that as parse failure.
 * - Identity escapes are allowed in string literals (e.g. "\\q" => "q").
 */

const fail = (expected: string): Parser<never> => {
  return (ctx) => failure(ctx, expected);
};

const decimalDigitChar: Parser<string> = map(digit(), (d) => d.toString());

const strictInvalidDigitEscape: Parser<number> = (ctx) => {
  const d = digit()(ctx);
  if (!d.success) return d;
  if (d.value === 0) return failure(ctx, "strict mode digit escape");
  return d;
};

const hex2 = map(repeat(2, hexDigit()), (xs) => xs.join(""));
const hex4 = map(repeat(4, hexDigit()), (xs) => xs.join(""));

const hex1to6 = any(
  map(repeat(6, hexDigit()), (xs) => xs.join("")),
  map(repeat(5, hexDigit()), (xs) => xs.join("")),
  map(repeat(4, hexDigit()), (xs) => xs.join("")),
  map(repeat(3, hexDigit()), (xs) => xs.join("")),
  map(repeat(2, hexDigit()), (xs) => xs.join("")),
  map(repeat(1, hexDigit()), (xs) => xs.join("")),
);

const lineContinuationTail: Parser<string> = any(
  map(seq(str("\r"), optional(str("\n"))), () => ""),
  map(str("\n"), () => ""),
  map(str("\u2028"), () => ""),
  map(str("\u2029"), () => ""),
);

const singleEscapeChar = any(
  map(str("n"), () => "\n"),
  map(str("r"), () => "\r"),
  map(str("t"), () => "\t"),
  map(str("b"), () => "\b"),
  map(str("f"), () => "\f"),
  map(str("v"), () => "\v"),
  map(str("\\"), () => "\\"),
  map(str('"'), () => '"'),
  map(str("'"), () => "'"),
);

const zeroEscape: Parser<string> = map(
  seq(
    str("0"),
    // In JS strict mode, legacy octal escapes are forbidden, so `\0` must not be followed by a decimal digit.
    cut(not(decimalDigitChar), "strict mode: legacy octal escape"),
  ),
  () => "\0",
);

const hexEscape: Parser<string> = map(
  seq(str("x"), cut(hex2, "2 hex digits")),
  ([, digits]) => String.fromCharCode(parseInt(digits, 16)),
);

const unicodeEscape4Body: Parser<string> = map(
  cut(hex4, "4 hex digits"),
  (digits) => String.fromCharCode(parseInt(digits, 16)),
);

const unicodeCodePointEscapeBody: Parser<string> = (ctx) => {
  const open = str("{")(ctx);
  if (!open.success) return open;

  const digitsRes = cut(hex1to6, "1-6 hex digits") /* committed */(open.ctx);
  if (!digitsRes.success) return digitsRes;

  const close = cut(str("}"), "'}'") /* committed */(digitsRes.ctx);
  if (!close.success) return close;

  const cp = parseInt(digitsRes.value, 16);
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10FFFF) {
    return failure(close.ctx, "unicode code point");
  }

  return success(close.ctx, String.fromCodePoint(cp));
};

const unicodeEscape: Parser<string> = (ctx) => {
  const u = str("u")(ctx);
  if (!u.success) return u;
  return cut(
    any(unicodeCodePointEscapeBody, unicodeEscape4Body),
    "unicode escape",
  )(
    u.ctx,
  );
};

const identityEscapeChar = regex(/[^\n\r\u2028\u2029]/, "escape character");

const strictDigitEscapeError: Parser<never> = (ctx) => {
  const d = strictInvalidDigitEscape(ctx);
  if (!d.success) return d;
  return cut(fail("strict mode: digit escapes are not allowed"))(d.ctx);
};

const escapeSequence: Parser<string> = any(
  // Line continuation: backslash + line terminator => contributes no character.
  map(lineContinuationTail, (s) => s),
  singleEscapeChar,
  zeroEscape,
  // \xNN must be valid if it starts with 'x'.
  hexEscape,
  // \uXXXX / \u{...} must be valid if it starts with 'u'.
  unicodeEscape,
  // Digits are illegal in strict mode (covers legacy octal and \8/\9).
  strictDigitEscapeError,
  // Identity escapes (e.g. \q => "q")
  identityEscapeChar,
);

const escape = map(seq(str("\\"), escapeSequence), ([, ch]) => ch);

const makeStringLiteral = (quote: "'" | '"'): Parser<string> => {
  const normalChar = quote === '"'
    ? regex(/[^"\\\n\r\u2028\u2029]/, "string character")
    : regex(/[^'\\\n\r\u2028\u2029]/, "string character");

  return map(
    seq(
      str(quote),
      map(many(any(escape, normalChar)), (parts) => parts.join("")),
      str(quote),
    ),
    ([, body]) => body,
  );
};

export const createStringSpan = (lx: Lexer): Parser<StringSpan> => {
  const literal = any(makeStringLiteral('"'), makeStringLiteral("'"));

  return lx.lexeme(
    map(withSpan(literal), (s: WithSpan<string>): StringSpan => ({
      value: s.value,
      start: s.start,
      end: s.end,
    })),
  );
};
