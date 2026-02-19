// app/reports/page.tsx
import { requireAuth } from "@/lib/auth";

export default async function ReportsPage() {
  const user = await requireAuth();

  return (
    <div>
      <h1>Reports</h1>
      <p>Welcome {user.display_name}</p>
    </div>
  );
}
