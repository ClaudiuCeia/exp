import { Context } from "https://deno.land/x/combine@v0.0.2/mod.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export type NodeRange = {
  readonly start: number;
  readonly end: number;
};

export type TraversalCallbackMap = {
  [k in SyntaxKind]: (
    node: Node,
    parent?: Node,
    key?: string,
    index?: number
  ) => void;
};

type Scope = {
  locals: Record<string, unknown>;
};

export abstract class Node<T = unknown> {
  public readonly range: NodeRange;
  public readonly text: string;
  public value: T;
  public abstract readonly kind: SyntaxKind;
  public scope: Scope = {
    locals: {},
  };

  public constructor(value: unknown, before: Context, after: Context) {
    this.range = {
      start: before.index,
      end: after.index,
    };
    this.text = before.text.slice(before.index, after.index);
    this.value = this.parseValue(value);
  }

  protected abstract parseValue(val: unknown): T;
}
