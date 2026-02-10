export type Span = Readonly<{
  start: number;
  end: number;
}>;

export type NodeBase = Readonly<{
  span: Span;
}>;

export type Expr =
  | (NodeBase & { kind: "number"; value: number })
  | (NodeBase & { kind: "string"; value: string });
