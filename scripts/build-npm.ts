import { build, emptyDir } from "@deno/dnt";

const denoJson = JSON.parse(await Deno.readTextFile("./deno.json")) as {
  name: string;
  version: string;
};

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  test: false,
  typeCheck: "both",
  shims: {
    // Runtime-agnostic library; avoid injecting Deno polyfills.
    deno: false,
    timers: false,
    prompts: false,
    blob: false,
    crypto: false,
    domException: false,
    // `undici` controls fetch + Request/Response/Headers/FormData/File shims.
    undici: false,
    weakRef: false,
    webSocket: false,
  },
  package: {
    name: "@claudiu-ceia/exp",
    version: denoJson.version,
    description: "Small expression language toolkit",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/ClaudiuCeia/exp.git",
    },
    dependencies: {
      "@claudiu-ceia/combine": "^0.2.8",
    },
  },
  postBuild() {
    // no-op for now
  },
});
