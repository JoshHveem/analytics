import { withAuthedDb } from "./authed-db";

export type ReportCatalogItem = {
  id: string;
  title: string;
  category: string;
  route: string;
  description: string | null;
};

export type ReportCategory = {
  categoryKey: string;
  categoryLabel: string;
  reports: Array<ReportCatalogItem & { href: string }>;
};

function normalizeRoute(route: string): string {
  return String(route ?? "").trim().replace(/^\/+|\/+$/g, "");
}

function normalizeCategory(category: string): string {
  return String(category ?? "").trim().toLowerCase();
}

function toCategoryLabel(category: string): string {
  const cleaned = normalizeCategory(category).replace(/[_-]+/g, " ");
  if (!cleaned) {
    return "Other";
  }
  return cleaned.replace(/\b\w/g, (s) => s.toUpperCase());
}

export async function getActiveReports(): Promise<Array<ReportCatalogItem & { href: string }>> {
  return withAuthedDb(async ({ db }) => {
    const { rows } = await db.query<{
      id: string;
      title: string;
      category: string;
      route: string;
      description: string | null;
    }>(
      `
      SELECT id, title, category, route, description
      FROM meta.reports
      WHERE is_active = true
      ORDER BY lower(category), lower(title)
      `
    );

    return rows
      .map((row: { id: string; title: string; category: string; route: string; description: string | null }) => {
        const route = normalizeRoute(row.route);
        return {
          id: String(row.id),
          title: String(row.title ?? route),
          category: normalizeCategory(row.category),
          route,
          description: row.description ?? null,
          href: `/reports/${route}`,
        };
      })
      .filter(
        (row: { route: string }) => row.route.length > 0
      );
  });
}

export async function getActiveReportCategories(): Promise<ReportCategory[]> {
  const reports = await getActiveReports();
  const grouped = new Map<string, ReportCategory>();

  for (const report of reports) {
    const key = report.category || "other";
    const existing = grouped.get(key);
    if (existing) {
      existing.reports.push(report);
      continue;
    }

    grouped.set(key, {
      categoryKey: key,
      categoryLabel: toCategoryLabel(key),
      reports: [report],
    });
  }

  return Array.from(grouped.values());
}
