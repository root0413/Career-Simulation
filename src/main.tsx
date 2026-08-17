import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

/** Catch unhandled render errors — show a reset button instead of a black screen. */
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; msg: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, msg: "" };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, msg: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-6 text-gray-200 px-6 text-center">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-xl font-bold text-red-400">界面加载异常</h1>
          <p className="text-sm text-gray-500 max-w-md">
            游戏数据可能已损坏或与当前版本不兼容。
            <br />
            <span className="text-gray-600 font-mono text-xs break-all">{this.state.msg}</span>
          </p>
          <button
            onClick={() => {
              localStorage.removeItem("simple-fm-game");
              window.location.reload();
            }}
            className="px-8 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold transition-colors cursor-pointer"
          >
            🔄 一键重置数据
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
