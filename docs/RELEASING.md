# Releasing

The three packages (`@effect-atom-query/query`, `/react`, `/devtools`) are
versioned together with [Changesets](https://github.com/changesets/changesets)
and published **from GitHub Actions only**, with npm provenance (decision D12,
replacing D6's manual publishing). No one publishes from a laptop, and no npm
token is stored anywhere.

## Release channels and cadence

| dist-tag | versions                    | who should install it            |
| -------- | --------------------------- | -------------------------------- |
| `next`   | prereleases: `1.3.0-next.0` | early adopters, our own trials   |
| `latest` | stable: `1.3.0`, `1.3.1`    | everyone (`npm install` default) |

- **New minor and major versions go to `next` first** and stay there for at
  least 3 days before the same changes are released as stable. Patch
  releases may go straight to `latest`.
- **At most one `latest` release per 7 days.** The Release workflow enforces
  this (`scripts/release-guard.ts`). The only exception is a security fix:
  run the workflow with `skip-cadence`, and say why in the changelog.
- Never publish several stable versions on one day. Consumers who set npm's
  `minimum-release-age` (or similar) will not be able to install them, and a
  version replaced within hours tells them the release was not ready.

## While developing

Describe user-facing changes in a changeset as part of the change:

```sh
pnpm changeset          # pick a bump (patch / minor / major) and write a summary
```

The changeset is a markdown file in `.changeset/`; commit it with the change.

## Cutting a prerelease (`next`)

```sh
pnpm changeset pre enter next   # once per release cycle; writes .changeset/pre.json
pnpm version-packages           # 1.3.0-next.0, then -next.1, ...
git commit -am "Version packages v1.3.0-next.0"
```

Merge that commit to `main` through a pull request, then run the **Release**
workflow (Actions → Release → Run workflow) on `main` with `dist-tag: next`.

## Cutting a stable release (`latest`)

```sh
pnpm changeset pre exit         # only when leaving prerelease mode
pnpm version-packages           # 1.3.0
git commit -am "Version packages v1.3.0"
```

Merge it to `main`, then run the **Release** workflow with `dist-tag: latest`.

## What the Release workflow does

1. Runs `vp run ready` (format, lint, type check, tests, builds, size budget).
2. Runs the release guard: every package has the same version, `next` gets a
   prerelease and `latest` a stable version, and `latest` respects the
   7-day cadence.
3. Packs each package with pnpm (rewriting `catalog:` / `workspace:` ranges
   and applying `publishConfig`).
4. Publishes query, react and devtools, in that order, with
   `npm publish --provenance`, authenticated by npm trusted publishing
   (OIDC). Versions that are already published are skipped, so a run that
   failed half-way can simply be re-run.
5. Creates and pushes the git tags (`@effect-atom-query/query@1.3.0`, …).

The job runs in the `npm` GitHub environment. Protect that environment
(below) and every publish waits for an approval.

`vp run release:check` packs every package and dry-runs the publish
locally and in CI, without uploading anything.

## What gets published

- Only `dist/` (plus `package.json`, `README.md` and `LICENSE`).
  `publishConfig.exports` drops the workspace-only
  `@effect-atom-query/source` condition.
- `catalog:` and `workspace:^` ranges are rewritten to real versions by pnpm.
- Each version carries a provenance attestation linking it to the workflow
  run and commit that built it. Verify installed packages with
  `npm audit signatures`.

## Review

Every change reaches `main` through a pull request that passes CI. Changes
to `packages/*/src` need a review from someone other than the author: a
second maintainer, or, while there is only one, an automated review (for
example CodeRabbit) plus a self-review after it, recorded in the PR.
`.github/CODEOWNERS` requests the owners' review automatically.

## Support policy

- **Bug fixes** go to the latest minor version of the current major
  (`1.3.x` once 1.3.0 is out).
- **Security fixes** also go to the previous minor for 3 months after the
  next minor was released.
- **Deprecations** are announced in the changelog and marked `@deprecated` in
  the code, with the replacement, at least one minor release before removal.
  Removals happen only in a major release.
- **Breaking changes** happen only in major releases, which are announced on
  `next` for at least two weeks.
- **Peer dependencies**: each minor states the `effect`, `@effect/atom-react`
  and React versions it supports. Raising the minimum is a minor change,
  announced in the changelog.

## One-time setup

These are settings outside the repository, done once by an owner.

1. **npm trusted publishing.** On npmjs.com, for each of the three packages:
   Settings → Trusted publishing → GitHub Actions, with repository
   `tjercus/effect-atom-query`, workflow `release.yml` and environment
   `npm`.
2. **Disallow token publishing.** Once a release has gone out through the
   workflow, set each package's publishing access to "Require two-factor
   authentication and disallow tokens", so only the workflow can publish.
3. **GitHub environment.** Settings → Environments → `npm`: allow the `main`
   branch only, and add required reviewers to approve each publish.
4. **Branch protection** on `main`: require a pull request, the CI checks
   (`ready`, `react-min`) and, once there is a second maintainer, a review
   from code owners.
5. **GitHub Pages.** Settings → Pages → Source: "GitHub Actions", so
   `.github/workflows/docs.yml` deploys
   https://tjercus.github.io/effect-atom-query/ on every push to `main` that
   touches `apps/docs`.
