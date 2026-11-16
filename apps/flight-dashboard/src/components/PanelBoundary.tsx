/**
 * Typed errors are values: components render them (see `FailureBanner`).
 * Defects are bugs: `useQuery` throws them to the nearest error boundary.
 * Each panel gets its own boundary, so one crash does not take the page down.
 */
import { QueryErrorResetBoundary } from "@effect-atom-query/react";
import { Component, type ReactNode } from "react";

interface BoundaryProps {
  readonly title: string;
  readonly onReset: () => void;
  readonly children?: ReactNode;
}

interface BoundaryState {
  readonly error: unknown;
}

class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: undefined };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  private readonly retry = () => {
    this.props.onReset();
    this.setState({ error: undefined });
  };

  override render() {
    if (this.state.error === undefined) return this.props.children;
    const message = this.state.error instanceof Error ? this.state.error.message : "Unknown defect";
    return (
      <section className="panel">
        <h2>{this.props.title}</h2>
        <div className="banner defect" role="alert">
          <strong>Defect · not a typed error</strong>
          <span>
            {message}. A defect is a bug, so it is not in the error type and the retry schedule
            never sees it. It was thrown to this panel's error boundary.
          </span>
        </div>
        <button onClick={this.retry}>Try again</button>
      </section>
    );
  }
}

export function PanelBoundary({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary title={title} onReset={reset}>
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
