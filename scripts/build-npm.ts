import { build, emptyDir } from "@deno/dnt";

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  shims: {
    deno: true,
  },
  package: {
    name: "@claudiu-ceia/exp",
    version: Deno.env.get("DENO_JSON_VERSION") ?? "0.1.0",
    description: "Small expression language toolkit",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/ClaudiuCeia/exp.git",
    },
  },
  postBuild() {
    // no-op for now
  },
});
