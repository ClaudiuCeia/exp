import { exp } from "../src/exp.ts";

let code = "";
for (const [idx, arg] of Deno.args.entries()) {
    if (arg === "--file" || arg === "-f") {
        const filename = Deno.args[idx+1];
        if (!filename) {
            console.warn("No file received for parsing");
            Deno.exit(1);
        }

        try {
            code = await Deno.readTextFile(filename);
        } catch (err) {
            console.error(`Error reading "${filename}" contents`);
            throw err;
        }
    }
}

const res = exp()({ text: code, index: 0 });
console.log(JSON.stringify(res, undefined, 2));

