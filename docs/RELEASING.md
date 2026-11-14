# Releasing

The three packages (`@effect-atom-query/query`, `/react`, `/devtools`) are
versioned together with [Changesets](https://github.com/changesets/changesets)
and published manually (decision D6).

## While developing

Describe user-facing changes in a changeset as part of the change:

```sh
pnpm changeset          # pick a bump (patch / minor / major) and write a summary
```

The changeset is a markdown file in `.changeset/`; commit it with the change.

## Cutting a release

```sh
pnpm version-packages   # apply changesets: bump versions, write CHANGELOG.md files
git commit -am "Release vX.Y.Z"
pnpm release:check      # build and dry-run publish: verify contents and registry
npm login               # once, with an account in the @effect-atom-query org
pnpm release            # vp run ready, then changeset publish (publishes + tags)
git push --follow-tags
```

## What gets published

- Only `dist/` (plus `package.json`). `publishConfig.exports` drops the
  workspace-only `@effect-atom-query/source` condition.
- `catalog:` and `workspace:^` ranges are rewritten to real versions by pnpm.
- `publishConfig.registry` pins `https://registry.npmjs.org/`, so a global
  npm config pointing at a company mirror cannot redirect the publish.

## Before the first publish

- Create the `@effect-atom-query` organisation on npmjs.com from the
  `tjercus` account.
- Push the repository to `github.com/tjercus/effect-atom-query` (the
  `repository`, `homepage` and `bugs` fields point there).

- In the GitHub repository, set Settings → Pages → Source to "GitHub Actions".
  `.github/workflows/docs.yml` then deploys the docs site to
  https://tjercus.github.io/effect-atom-query/ on every push to `main` that touches `apps/docs`.

Each package ships its own `README.md` and `LICENSE` (MIT © tjercus).
