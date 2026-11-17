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

## Coding guidelines

### Follow Effect's own guidelines

Write code the way the Effect project does. Its guidance lives in the checkout:

- `docs/repos/effect/LLMS.md` and `docs/repos/effect/ai-docs/src` — how to write Effect code
  (`Effect.gen`, `Effect.fn` / `Effect.fnUntraced`, errors, services, layers, schema, testing)
- `docs/repos/effect/.agents/skills/effect-development/SKILL.md` — API conventions (inline
  `readonly` option types, `| undefined` on optional fields, signatures)
- `docs/repos/effect/.agents/skills/test-development` — testing conventions

Before using or designing an Effect API or pattern, search these for it and follow what they show.
Where they say nothing, match the surrounding code in this repo.

### Do not throw unless there is no alternative

Failures are values. Use the error channel (`E` in `Effect<A, E, R>`) for expected failures, and
`Result` / `Option` / `Exit` in synchronous code, so callers see failures in the types.

- Do not `throw` for expected failures, and do not use `try`/`catch` for control flow.
- Prefer non-throwing APIs: `Schema.decodeUnknownResult` over `decodeUnknownSync`, `Result.try`
  around third-party code that throws, `Option` over `getOrThrow` (narrow on the discriminant instead).
- Programmer errors and broken invariants inside an Effect are defects: `Effect.die`, not `throw`.
- When code must catch exceptions from user-supplied or third-party code (schemas, callbacks,
  `JSON.stringify`), do it at one narrow boundary that turns them into values, as
  `packages/query/src/internal/persistCodec.ts` does. Never write an empty `catch {}` that hides
  the reason.
- Throwing is acceptable only where a contract requires it, e.g. an atom read function signalling
  failure to the Atom registry (`QueryClient.fromAtomContext`). Document such throws in JSDoc.
