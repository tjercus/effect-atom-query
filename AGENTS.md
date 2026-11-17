# Agent Guidelines

## Effect source reference

A checkout of the Effect monorepo lives in `docs/repos/effect` (git-ignored, not part of this project).
Use it as the primary reference when writing or reviewing code that uses Effect, instead of relying on
memory of older Effect APIs (Effect 4 differs substantially from Effect 3).

Useful locations:

- `docs/repos/effect/packages/effect/src` — core `effect` package (`Effect`, `Schema`, `Stream`, `Layer`, ...)
- `docs/repos/effect/packages/effect/src/reactivity` — `Atom`, `AtomRegistry`, `AtomRef`, `AtomRpc`, `AtomHttpApi`
- `docs/repos/effect/packages/atom/react` — `@effect/atom-react`
- `docs/repos/effect/packages/platform/browser` — `@effect/platform-browser`
- `docs/repos/effect/packages/vitest` — `@effect/vitest`
- `docs/repos/effect/ai-docs`, `LLMS.md`, `MIGRATION.md` — usage examples and migration notes

Prefer reading source, JSDoc and tests there to confirm signatures and behavior. Never import from
`docs/repos` in project code.

The checkout is pinned to the tag matching the installed `effect` version (see `pnpm-workspace.yaml`
catalog). If missing or the version changed, (re)create it:

```sh
rm -rf docs/repos/effect
git clone --depth 1 --branch effect@<version> https://github.com/Effect-TS/effect.git docs/repos/effect
```
