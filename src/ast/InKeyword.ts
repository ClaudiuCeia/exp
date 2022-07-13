import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class InKeyword extends Node<"in"> {
  readonly kind = SyntaxKind.InKeyword;

  protected parseValue(v: unknown): "in" {
    if (v !== "in") {
      throw new Error();
    }

    return v;
  }
}
