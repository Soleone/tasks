import { Component, type ErrorInfo, type ReactNode } from "react";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { Button } from "@/components/variants/button";

type State = { error: Error | null; componentStack: string; reporting: boolean };

/** Task data is written by the backend, so a render error costs the screen, never a task. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, componentStack: "", reporting: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(_error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  render(): ReactNode {
    const { error, componentStack, reporting } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex h-dvh flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-lg font-medium">Something went wrong</h1>
        <p className="max-w-md text-center text-sm text-muted-foreground wrap-anywhere">
          {error.message || "Tasks hit an unexpected error."} Your tasks are safe.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="ghost" onClick={() => this.setState({ reporting: true })}>
            Send feedback
          </Button>
        </div>
        {reporting && (
          <FeedbackDialog
            initial={{
              title: `Crash: ${error.message}`.slice(0, 200),
              description: `${error.stack ?? error.message}\n${componentStack}`.slice(0, 10_000),
            }}
            onClose={() => this.setState({ reporting: false })}
          />
        )}
      </div>
    );
  }
}
