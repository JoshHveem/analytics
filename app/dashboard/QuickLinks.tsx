import Link from "next/link";
import { getActiveReports } from "@/lib/report-catalog";

export default async function QuickLinks() {
  const reports = await getActiveReports();
  const topReports = reports.slice(0, 3).map((r) => ({ href: r.href, label: r.title }));
  const links = [
    { href: "/reports", label: "All Reports" },
    ...topReports,
    { href: "/api/me", label: "My Profile (API)" },
  ];

  return (
    <nav className="mt-4 flex flex-col gap-3">
      {links.map((l) => (
        <Link
          key={`${l.href}-${l.label}`}
          href={l.href}
          className="block rounded-md border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--app-border)",
            backgroundColor: "var(--app-surface-muted)",
            color: "var(--app-text-strong)",
          }}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
