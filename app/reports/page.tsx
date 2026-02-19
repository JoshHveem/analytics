// app/reports/page.tsx
import { requireAuth } from "@/lib/auth";

export default async function ReportsPage() {
  const user = await requireAuth();

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6">
      <h1 className="text-2xl font-bold">Reports</h1>
      <p className="mt-2 text-zinc-600">Welcome {user.display_name}</p>
    </div>
  );
}
