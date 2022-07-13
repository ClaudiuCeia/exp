import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class LessThanOrEqualToken extends Node<"<="> {
  readonly kind = SyntaxKind.LessThanOrEqualToken;

  protected parseValue(v: unknown): "<=" {
    if (v !== "<=") {
      throw new Error();
    }

    return v;
  }
}
