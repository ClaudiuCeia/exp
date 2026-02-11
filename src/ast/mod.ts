export type Span = Readonly<{
  start: number;
  end: number;
}>;

export type NodeBase = Readonly<{
  span: Span;
}>;

export type UnaryOp = "!" | "-" | "+";

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||";

export type Expr =
  | (NodeBase & { kind: "number"; value: number })
  | (NodeBase & { kind: "string"; value: string })
  | (NodeBase & { kind: "boolean"; value: boolean })
  | (NodeBase & { kind: "null" })
  | (NodeBase & { kind: "identifier"; name: string })
  | (NodeBase & { kind: "array"; elements: Expr[] })
  | (NodeBase & { kind: "unary"; op: UnaryOp; expr: Expr })
  | (NodeBase & { kind: "binary"; op: BinaryOp; left: Expr; right: Expr })
  | (NodeBase & { kind: "member"; object: Expr; property: string })
  | (NodeBase & { kind: "call"; callee: Expr; args: Expr[] })
  | (NodeBase & {
    kind: "conditional";
    test: Expr;
    consequent: Expr;
    alternate: Expr;
  });

export const mkUnary = (op: UnaryOp, start: number, expr: Expr): Expr => {
  return {
    kind: "unary",
    op,
    expr,
    span: { start, end: expr.span.end },
  };
};

export const mkBinary = (left: Expr, op: BinaryOp, right: Expr): Expr => {
  return {
    kind: "binary",
    op,
    left,
    right,
    span: { start: left.span.start, end: right.span.end },
  };
};

export const mkMember = (
  object: Expr,
  property: { value: string; end: number },
): Expr => {
  return {
    kind: "member",
    object,
    property: property.value,
    span: { start: object.span.start, end: property.end },
  };
};

export const mkCall = (callee: Expr, args: Expr[], end: number): Expr => {
  return {
    kind: "call",
    callee,
    args,
    span: { start: callee.span.start, end },
  };
};
