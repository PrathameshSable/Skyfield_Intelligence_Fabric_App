import type { FallbackProps } from "react-error-boundary";

/** Full-canvas error surface shown if the globe or a data query throws. */
export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="stage error-stage" role="alert">
      <div className="error-card">
        <div className="error-card__title">Skyfield hit turbulence</div>
        <p className="error-card__msg">{error instanceof Error ? error.message : String(error)}</p>
        <button className="band band--on" onClick={resetErrorBoundary}>
          Retry
        </button>
      </div>
    </div>
  );
}
