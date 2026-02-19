export default function Hero() {
  return (
    <header className="rounded-lg bg-white/80 p-8 shadow-sm dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold">Instructor Dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-xl">
            Welcome — this dashboard helps you quickly find and explore student progress,
            program outcomes, course quality metrics, and other important signals.
          </p>
        </div>

        <div className="hidden items-center gap-4 sm:flex">
          <div className="rounded-full bg-zinc-100 px-3 py-2 text-sm">Last 30 days</div>
        </div>
      </div>
    </header>
  );
}
