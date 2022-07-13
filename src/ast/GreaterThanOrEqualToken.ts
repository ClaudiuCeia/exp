import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class GreaterThanOrEqualToken extends Node<">="> {
  readonly kind = SyntaxKind.GreaterThanOrEqualToken;

  protected parseValue(v: unknown): ">=" {
    if (v !== ">=") {
      throw new Error();
    }

    return v;
  }
}
