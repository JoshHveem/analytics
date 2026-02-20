// app/reports/page.tsx
import { requireAuth } from "@/lib/auth";
import Link from "next/link";
import { getActiveReportCategories } from "@/lib/report-catalog";
import { ReportContainer } from "./_components/ReportContainer";

export default async function ReportsPage() {
  const user = await requireAuth();
  const categories = await getActiveReportCategories();

  return (
    <ReportContainer padding="lg">
      <h1 className="text-2xl font-bold">Reports</h1>
      <p className="mt-2" style={{ color: "var(--app-text-muted)" }}>
        Welcome {user.display_name}
      </p>

      <div className="mt-6 space-y-5">
        {categories.map((category) => (
          <section key={category.categoryKey}>
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--app-text-muted)" }}>
              {category.categoryLabel}
            </h2>
            <ul className="mt-2 space-y-2">
              {category.reports.map((report) => (
                <li key={report.id}>
                  <ReportContainer padding="sm" radius="md">
                    <Link href={report.href} className="text-sm font-medium hover:underline" style={{ color: "var(--app-text-strong)" }}>
                      {report.title}
                    </Link>
                    {report.description && (
                      <p className="mt-1 text-xs" style={{ color: "var(--app-text-muted)" }}>
                        {report.description}
                      </p>
                    )}
                  </ReportContainer>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {categories.length === 0 && (
          <p className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            No active reports are configured.
          </p>
        )}
      </div>
    </ReportContainer>
  );
}
