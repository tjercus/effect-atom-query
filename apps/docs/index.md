---
layout: home
hero:
  name: effect-native-query
  text: Server state for React, the Effect way
  tagline: TanStack Query's caching model, built on Effect and Effect Atoms. Typed errors, services and Schedules all the way down, and Option instead of undefined.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Coming from TanStack Query
      link: /guide/from-tanstack
features:
  - title: Queries are atoms
    details: Define a query once at module level. Read it with useQuery, useAtomValue, or any Atom combinator; fetch it imperatively as an Effect.
  - title: Effects, not promises
    details: run is an Effect with typed errors and services from your runtime. Retries are Schedules. Cancellation is fiber interruption.
  - title: No undefined
    details: data and error are Options. Results are a tagged union (Pending, Success, Failure) and carry the AsyncResult for atom interop.
  - title: TanStack defaults
    details: staleTime, gcTime, refetch on mount, focus and reconnect, retries with backoff, request deduplication, structural sharing.
  - title: Batteries included
    details: Mutations with optimistic updates, infinite queries, Suspense, error reset boundaries, prefetching, polling, offline mode.
  - title: Typed persistence
    details: Opt queries into persistence with a Schema; restored data is decoded with it, so DateTime, Option and branded types survive a reload.
---
