"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type RecommendedReport = {
  id: string;
  title: string;
  category: string;
  route: string;
  href: string;
  description: string | null;
  reason: string;
  confidence: number | null;
};

export default function ReportFinder() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<RecommendedReport[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = query.trim();
    if (!search) {
      return;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const response = await fetch("/api/reports/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: search }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as { recommendations?: RecommendedReport[] };
      setReports(Array.isArray(payload.recommendations) ? payload.recommendations : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to fetch recommendations.";
      setReports([]);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen px-6 py-16" style={{ backgroundColor: "var(--app-background)", color: "var(--app-text-strong)" }}>
      <main className="mx-auto max-w-4xl">
        <section
          className="rounded-xl border p-8 shadow-sm"
          style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)" }}
        >
          <h1 className="text-3xl font-semibold" style={{ color: "var(--app-text-strong)" }}>
            What are you looking for?
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--app-text-muted)" }}>
            Describe what you need, and we will suggest the best matching reports.
          </p>

          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Example: students likely to complete this year"
              className="w-full rounded-md border px-4 py-3 text-sm outline-none transition"
              style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="rounded-md border px-5 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-70"
              style={{
                borderColor: "var(--app-border)",
                backgroundColor: loading || !query.trim() ? "var(--app-surface-muted)" : "var(--app-control-track-active)",
                color: loading || !query.trim() ? "var(--app-text-muted)" : "var(--app-control-thumb)",
              }}
            >
              {loading ? "Searching..." : "Find reports"}
            </button>
          </form>
        </section>

        <section className="mt-6">
          {error && (
            <div
              className="rounded-md border p-4 text-sm"
              style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface-muted)", color: "var(--app-text-strong)" }}
            >
              {error}
            </div>
          )}

          {!error && hasSearched && !loading && reports.length === 0 && (
            <div
              className="rounded-md border p-4 text-sm"
              style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-muted)" }}
            >
              No report recommendations found for that search.
            </div>
          )}

          {reports.length > 0 && (
            <div className="space-y-3">
              {reports.map((report) => (
                <article
                  key={report.id}
                  className="rounded-lg border p-5 shadow-sm"
                  style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={report.href} className="text-base font-semibold hover:underline" style={{ color: "var(--app-text-strong)" }}>
                      {report.title}
                    </Link>
                    <span
                      className="rounded-full border px-2 py-1 text-xs uppercase tracking-wide"
                      style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface-muted)", color: "var(--app-text-muted)" }}
                    >
                      {report.category || "other"}
                    </span>
                  </div>
                  {report.description && <p className="mt-2 text-sm" style={{ color: "var(--app-text-muted)" }}>{report.description}</p>}
                  <p className="mt-2 text-sm" style={{ color: "var(--app-text-strong)" }}>{report.reason}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
