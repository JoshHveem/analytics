export default function Hero() {
  return (
    <header className="rounded-lg p-8 shadow-sm" style={{ backgroundColor: "var(--app-surface)" }}>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold">Instructor Dashboard</h1>
          <p className="mt-2 max-w-xl text-sm" style={{ color: "var(--app-text-muted)" }}>
            Welcome - this dashboard helps you quickly find and explore student progress,
            program outcomes, course quality metrics, and other important signals.
          </p>
        </div>

        <div className="hidden items-center gap-4 sm:flex">
          <div
            className="rounded-full border px-3 py-2 text-sm"
            style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface-muted)", color: "var(--app-text-muted)" }}
          >
            Last 30 days
          </div>
        </div>
      </div>
    </header>
  );
}
