import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertOctagon, RotateCcw } from "lucide-react";

interface State { error: Error | null }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("UI error:", error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot">
        <div className="panel crash">
          <div className="empty-icon warn"><AlertOctagon size={28} /></div>
          <h2>Something went wrong</h2>
          <p className="muted">The page hit an unexpected error. Your data is safe — reload to continue.</p>
          <pre>{this.state.error.message}</pre>
          <button className="btn btn-primary" onClick={() => location.reload()}><RotateCcw size={15} /> Reload</button>
        </div>
      </div>
    );
  }
}
