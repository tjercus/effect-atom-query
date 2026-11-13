# effect-native-query

TanStack Query–style server-state caching for React, written as idiomatic
[Effect](https://effect.website). It is built on Effect Atoms
(`effect/reactivity`) and `@effect/atom-react`.

- `packages/query` holds the framework-agnostic core.
- `packages/react` holds the React hooks and provider.
- `apps/playground` is a Vite+ React playground.

See [docs/PLAN.md](docs/PLAN.md) for the plan,
[docs/FEATURE-MATRIX.md](docs/FEATURE-MATRIX.md) for TanStack parity, and
[docs/QUESTIONS.md](docs/QUESTIONS.md) for decisions.

```sh
vp install        # install
vp check          # format + lint + type-check (TypeScript 7)
vp run -r test    # tests
vp run -r build   # build packages + playground
vp run dev        # playground dev server
```
