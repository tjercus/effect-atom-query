/**
 * Bundle-size budget. Bundles small consumer entry points against the built
 * packages (`dist`), minified and tree-shaken as an app bundler would, and
 * compares the gzipped size with `size-budget.json`.
 *
 * Peer dependencies (effect, react, @effect/atom-react) are external unless
 * an entry sets `bundlePeers`, so budgets track this library's own code.
 *
 *   vpx ./scripts/size.ts            # check
 *   vpx ./scripts/size.ts --update   # rewrite budgets (current size + 10%)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";

interface Entry {
  readonly name: string;
  readonly code: string;
  readonly bundlePeers?: boolean;
}

const entries: ReadonlyArray<Entry> = [
  {
    name: "query: everything",
    code: `export * from "@effect-atom-query/query"`,
  },
  {
    name: "query: Query.make + QueryClient.layer",
    code: `import { Query, QueryClient } from "@effect-atom-query/query"
export const q = Query.make({ key: (id) => ["todo", id], run: () => null })
export const layer = QueryClient.layer()`,
  },
  {
    name: "react: everything",
    code: `export * from "@effect-atom-query/react"`,
  },
  {
    name: "react: provider + useQuery",
    code: `export { QueryClientProvider, useQuery, Query, QueryClient } from "@effect-atom-query/react"`,
  },
  {
    name: "react: provider + useQuery, with effect and react",
    code: `export { QueryClientProvider, useQuery, Query, QueryClient } from "@effect-atom-query/react"`,
    bundlePeers: true,
  },
  {
    name: "devtools (production build)",
    code: `export { QueryDevtools, QueryDevtoolsPanel } from "@effect-atom-query/devtools"`,
  },
];

const root = fileURLToPath(new URL("..", import.meta.url));
const budgetFile = `${root}size-budget.json`;
const peers = [
  /^effect(\/|$)/,
  /^react(\/|$)/,
  /^react-dom(\/|$)/,
  /^@effect\/atom-react(\/|$)/,
  /^scheduler$/,
];

const cacheDir = `${root}node_modules/.cache/size/`;
mkdirSync(cacheDir, { recursive: true });

const measure = async (entry: Entry, index: number): Promise<number> => {
  const file = `${cacheDir}entry-${index}.mjs`;
  writeFileSync(file, entry.code);
  const output = await build({
    configFile: false,
    logLevel: "silent",
    root,
    resolve: {
      alias: {
        "@effect-atom-query/query": `${root}packages/query/dist/index.mjs`,
        "@effect-atom-query/react": `${root}packages/react/dist/index.mjs`,
        "@effect-atom-query/devtools": `${root}packages/devtools/dist/index.mjs`,
      },
    },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      minify: true,
      lib: { entry: file, formats: ["es"], fileName: "entry" },
      rollupOptions: {
        external: entry.bundlePeers ? [] : (id) => peers.some((re) => re.test(id)),
      },
    },
  });
  const outputs = Array.isArray(output) ? output : [output];
  let size = 0;
  for (const out of outputs) {
    if (!("output" in out)) continue;
    for (const chunk of out.output) {
      if (chunk.type === "chunk") size += gzipSync(chunk.code, { level: 9 }).length;
    }
  }
  return size;
};

const update = process.argv.includes("--update");
const budgets: Record<string, number> = update
  ? {}
  : (JSON.parse(readFileSync(budgetFile, "utf8")) as Record<string, number>);

const kb = (n: number) => `${(n / 1024).toFixed(2)} kB`;
let failed = false;
const next: Record<string, number> = {};
for (const [index, entry] of entries.entries()) {
  const size = await measure(entry, index);
  const budget = budgets[entry.name];
  next[entry.name] = Math.max(256, Math.ceil((size * 1.1) / 64) * 64);
  const over = budget !== undefined && size > budget;
  if (over || (!update && budget === undefined)) failed = true;
  const status = update ? "updated" : budget === undefined ? "NO BUDGET" : over ? "OVER" : "ok";
  console.log(
    `${status.padEnd(9)} ${entry.name.padEnd(52)} ${kb(size).padStart(10)}${budget === undefined ? "" : ` / ${kb(budget)}`}`,
  );
}

if (update) {
  writeFileSync(budgetFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\nWrote ${budgetFile}`);
} else if (failed) {
  console.error(
    "\nBundle size budget exceeded (min+gzip). Run with --update if the growth is intended.",
  );
  process.exit(1);
}
