import { run } from "@stricli/core";
import { app } from "./app.ts";
import { bunContext } from "./commands.ts";

await run(app, Bun.argv.slice(2), bunContext);
