import { run } from "@stricli/core";
import { app } from "./app.ts";
import { denoContext } from "./commands.ts";

// `deno task ... -- <args>` typically passes a leading "--" to the script.
const argv = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;

await run(app, argv, denoContext);
