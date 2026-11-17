/**
 * Release guard, run by the Release workflow before anything is published.
 * Enforces the release policy in docs/RELEASING.md:
 *
 * - every package has the same version (they are versioned together);
 * - `next` publishes prereleases (`1.3.0-next.0`), `latest` publishes stable
 *   versions;
 * - `latest` gets at most one release per 7 days, unless `--skip-cadence` is
 *   passed (security fixes). Re-running a release that failed half-way is
 *   allowed: the version being released does not count against itself.
 *
 *   vpx ./scripts/release-guard.ts --tag next
 *   vpx ./scripts/release-guard.ts --tag latest [--skip-cadence]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CADENCE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

export interface RegistryInfo {
  /** `dist-tags`, e.g. `{ latest: "1.2.0" }`. */
  readonly distTags: Readonly<Record<string, string>>;
  /** Publish times by version (ISO strings), as in the registry's `time`. */
  readonly time: Readonly<Record<string, string>>;
}

export interface GuardInput {
  readonly tag: "next" | "latest";
  readonly versions: Readonly<Record<string, string>>;
  /** `undefined` when the package was never published. */
  readonly registry: RegistryInfo | undefined;
  readonly skipCadence: boolean;
  readonly now: number;
}

/** The reasons not to publish; empty when the release may go ahead. */
export const check = (input: GuardInput): ReadonlyArray<string> => {
  const problems: Array<string> = [];
  const distinct = new Set(Object.values(input.versions));
  if (distinct.size !== 1) {
    const list = Object.entries(input.versions).map(([name, v]) => `${name}@${v}`);
    return [`Packages have different versions: ${list.join(", ")}`];
  }
  const [version] = distinct as unknown as [string];
  const prerelease = version.includes("-");

  if (input.tag === "next" && !/-next\.\d+$/.test(version)) {
    problems.push(
      `"next" publishes prereleases like 1.3.0-next.0, but the version is ${version}. ` +
        `Enter prerelease mode first: pnpm changeset pre enter next`,
    );
  }
  if (input.tag === "latest" && prerelease) {
    problems.push(
      `"latest" publishes stable versions, but the version is ${version}. ` +
        `Exit prerelease mode first: pnpm changeset pre exit`,
    );
  }

  const current = input.registry?.distTags.latest;
  if (
    input.tag === "latest" &&
    !input.skipCadence &&
    current !== undefined &&
    current !== version
  ) {
    const published = input.registry?.time[current];
    const age = published === undefined ? Infinity : input.now - Date.parse(published);
    if (age < CADENCE_DAYS * DAY) {
      const days = (age / DAY).toFixed(1);
      problems.push(
        `The current latest (${current}) was published ${days} days ago; stable releases are at ` +
          `least ${CADENCE_DAYS} days apart. Publish to "next" instead, or re-run with ` +
          `skip-cadence for a security fix.`,
      );
    }
  }
  return problems;
};

const root = fileURLToPath(new URL("..", import.meta.url));
const packages = ["query", "react", "devtools"] as const;

const readVersions = (): Record<string, string> =>
  Object.fromEntries(
    packages.map((dir) => {
      const pkg = JSON.parse(readFileSync(`${root}packages/${dir}/package.json`, "utf8")) as {
        readonly name: string;
        readonly version: string;
      };
      return [pkg.name, pkg.version];
    }),
  );

/** Public package metadata from the npm registry (no credentials sent). */
const fetchRegistry = async (name: string): Promise<RegistryInfo | undefined> => {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Registry lookup for ${name} failed: ${response.status}`);
  }
  const body = (await response.json()) as {
    readonly "dist-tags"?: Record<string, string>;
    readonly time?: Record<string, string>;
  };
  return { distTags: body["dist-tags"] ?? {}, time: body.time ?? {} };
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const tag = args[args.indexOf("--tag") + 1];
  if (tag !== "next" && tag !== "latest") {
    console.error("Usage: release-guard.ts --tag next|latest [--skip-cadence]");
    process.exit(2);
  }
  const versions = readVersions();
  const problems = check({
    tag,
    versions,
    // The packages are released together, so the core's history stands for all.
    registry: await fetchRegistry("@effect-atom-query/query"),
    skipCadence: args.includes("--skip-cadence"),
    now: Date.now(),
  });
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`✗ ${problem}`);
    }
    process.exit(1);
  }
  console.log(`✓ ${Object.values(versions)[0]} may be published to "${tag}"`);
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
