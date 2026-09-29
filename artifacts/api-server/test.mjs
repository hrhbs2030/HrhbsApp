import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundle the TypeScript tests with the esbuild already used for the server
// build. The server's own npm imports stay external and load from its
// node_modules; the workspace libraries and their dependencies are bundled,
// since pnpm only links those packages inside each library.
const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(artifactDir, "tests");
const outDir = path.resolve(artifactDir, ".test-dist");

const externalPackages = {
  name: "external-packages",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith("@workspace/") ||
      !args.importer.startsWith(artifactDir + path.sep)
        ? undefined
        : { external: true },
    );
  },
};

const entryPoints = (await readdir(testsDir))
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => path.join(testsDir, file));

await rm(outDir, { recursive: true, force: true });
try {
  await build({
    entryPoints,
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
    platform: "node",
    format: "esm",
    target: "node22",
    bundle: true,
    sourcemap: "inline",
    logLevel: "warning",
    plugins: [externalPackages],
    // Bundled CommonJS packages (e.g. pg) call require; match build.mjs.
    banner: {
      js: `import { createRequire as __testCreateRequire } from "node:module";
globalThis.require = __testCreateRequire(import.meta.url);`,
    },
  });

  const outputs = (await readdir(outDir))
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => path.join(outDir, file));
  // node --test runs each file in its own process, so a test that sets
  // environment variables before importing the app cannot affect another.
  // One file at a time: the database tests share (and empty) the same tables.
  const result = spawnSync(
    process.execPath,
    ["--enable-source-maps", "--test", "--test-concurrency=1", ...outputs],
    { stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(outDir, { recursive: true, force: true });
}
