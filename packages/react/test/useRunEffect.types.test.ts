/**
 * Type-level tests for `useRunEffect`. The hook is only called inside
 * functions that never run; `vp check` type-checks them.
 */
import { Context, Effect, type Exit } from "effect";
import { describe, expectTypeOf, it } from "vite-plus/test";
import { type QueryClient, useRunEffect } from "../src/index.ts";

class Registered extends Context.Service<Registered, { readonly n: number }>()("test/Registered") {}
class Undeclared extends Context.Service<Undeclared, { readonly s: string }>()("test/Undeclared") {}

// What an app writes once. Through the package name, as users do.
declare module "@effect-atom-query/react" {
  interface Register {
    readonly services: Registered;
  }
}

declare const update: Effect.Effect<{ readonly id: 1 }, "UpdateError", Registered>;
declare const create: Effect.Effect<{ readonly id: 2 }, "CreateError", QueryClient.QueryClient>;
declare const undeclared: Effect.Effect<number, never, Undeclared>;
declare const mode: "edit" | "new";

describe("useRunEffect types", () => {
  it("infers a single Effect's exact types", () => {
    const run = () => useRunEffect().promiseExit(update);
    expectTypeOf(run).returns.resolves.toEqualTypeOf<
      Exit.Exit<{ readonly id: 1 }, "UpdateError">
    >();
    const value = () => useRunEffect().promise(update);
    expectTypeOf(value).returns.resolves.toEqualTypeOf<{ readonly id: 1 }>();
  });

  it("accepts a union of Effects", () => {
    const run = () => useRunEffect().promiseExit(mode === "edit" ? update : create);
    expectTypeOf(run).returns.resolves.toEqualTypeOf<
      Exit.Exit<{ readonly id: 1 } | { readonly id: 2 }, "UpdateError" | "CreateError">
    >();
  });

  it("accepts services declared in Register, and QueryClient", () => {
    const run = () => {
      const runner = useRunEffect();
      void runner.promise(Effect.flatMap(Registered, (r) => Effect.succeed(r.n)));
      void runner.promise(create);
    };
    expectTypeOf(run).toBeFunction();
  });

  it("rejects Effects that need undeclared services", () => {
    const run = () => {
      // @ts-expect-error Undeclared is not in Register
      void useRunEffect().promise(undeclared);
    };
    expectTypeOf(run).toBeFunction();
  });

  it("takes the services as a type argument instead", () => {
    const run = () => useRunEffect<Undeclared>().promise(undeclared);
    expectTypeOf(run).returns.resolves.toEqualTypeOf<number>();
  });
});
