import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../../lib/i18n";
import { ErrorState } from "./Page.js";

/**
 * Catches a render error so one broken panel never blanks the whole app.
 * Resets when `resetKey` changes (the route), so moving on clears it.
 */
export class ErrorBoundary extends Component<
  {
    children: ReactNode;
    resetKey?: string;
    fallback?: (reset: () => void, error: Error) => ReactNode;
  },
  { error: Error | null; key?: string }
> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { resetKey?: string },
    state: { error: Error | null; key?: string },
  ) {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept in the console for whoever is debugging; the person sees the screen below.
    console.error("Zelyq caught a render error", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset, error);
    return (
      <ErrorState
        title={t("This part of the page could not be shown")}
        error={t(
          "Something went wrong while drawing it. Try again; if it keeps happening, reload the page.{message}",
          {
            message: (
              <span className="mt-2 block font-mono text-xs text-fg-muted">{error.message}</span>
            ),
          },
        )}
        onRetry={this.reset}
      />
    );
  }
}
