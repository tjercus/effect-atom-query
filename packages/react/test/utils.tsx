import { QueryClient, QueryClientProvider } from "../src/index.ts";
import { ManagedRuntime } from "effect";
import * as React from "react";

/** A client on a live runtime (real clock), disposed with `dispose`. */
export const makeClient = (options?: QueryClient.Options) => {
  const runtime = ManagedRuntime.make(QueryClient.layer(options));
  const client = runtime.runSync(QueryClient.QueryClient);
  return { client, runtime, dispose: () => runtime.dispose() };
};

export const wrapper =
  (client: QueryClient.Service) =>
  ({ children }: { readonly children?: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

/** Counts runs of a query function. */
export const counter = () => {
  let n = 0;
  return {
    get count() {
      return n;
    },
    next: () => ++n,
  };
};

export class ErrorBoundary extends React.Component<
  { readonly children?: React.ReactNode },
  { readonly error: unknown }
> {
  override state = { error: undefined as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    return this.state.error === undefined ? (
      this.props.children
    ) : (
      <p>
        caught:{" "}
        {this.state.error instanceof Error
          ? this.state.error.message
          : String(this.state.error as string)}
      </p>
    );
  }
}

/** An error boundary with a "retry" button that calls `onReset` and re-renders its children. */
export class RetryBoundary extends React.Component<
  { readonly children?: React.ReactNode; readonly onReset?: (() => void) | undefined },
  { readonly error: unknown }
> {
  override state = { error: undefined as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    if (this.state.error === undefined) {
      return this.props.children;
    }
    return (
      <div>
        <p>
          caught:{" "}
          {this.state.error instanceof Error
            ? this.state.error.message
            : String(this.state.error as string)}
        </p>
        <button
          type="button"
          onClick={() => {
            this.props.onReset?.();
            this.setState({ error: undefined });
          }}
        >
          retry
        </button>
      </div>
    );
  }
}
