import Hero from "./dashboard/Hero";
import QuickLinks from "./dashboard/QuickLinks";
import Sidebar from "./dashboard/Sidebar";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black font-sans">
      <Sidebar />

      <main className="mx-auto max-w-5xl py-16 px-6 sm:ml-64">
        <Hero />

        <section className="mt-12">
          <div className="rounded-lg bg-white/80 p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="text-lg font-semibold">Data Overview</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Quick snapshot of recent course activity, student progress, and program outcomes. Use the links to the right to dive into specific reports.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="rounded-md bg-zinc-50 p-4">
                <div className="text-xs text-zinc-500">Active Students</div>
                <div className="mt-1 text-2xl font-bold">—</div>
              </div>
              <div className="rounded-md bg-zinc-50 p-4">
                <div className="text-xs text-zinc-500">Avg Course Rating</div>
                <div className="mt-1 text-2xl font-bold">—</div>
              </div>
              <div className="rounded-md bg-zinc-50 p-4">
                <div className="text-xs text-zinc-500">Courses At Risk</div>
                <div className="mt-1 text-2xl font-bold">—</div>
              </div>
              <div className="rounded-md bg-zinc-50 p-4">
                <div className="text-xs text-zinc-500">Outcome Targets Met</div>
                <div className="mt-1 text-2xl font-bold">—</div>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-lg bg-white/80 p-6 shadow-sm dark:bg-zinc-900">
            <h3 className="text-sm font-semibold">Quick Actions</h3>
            <QuickLinks />
          </div>
        </section>
      </main>
    </div>
  );
}
