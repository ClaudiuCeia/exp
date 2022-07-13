import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class BarBarToken extends Node<"||"> {
  readonly kind = SyntaxKind.BarBarToken;

  protected parseValue(v: unknown): "||" {
    if (v !== "||") {
      throw new Error();
    }

    return v;
  }
}
