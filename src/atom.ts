import { str } from "https://deno.land/x/combine@v0.0.2/mod.ts";
import { terminated } from "./combinators.ts";

export const doubleColon = terminated(str(":"));
export const questionMark = terminated(str("?"));
export const semiColon = terminated(str(";"));
export const comma = terminated(str(","));
