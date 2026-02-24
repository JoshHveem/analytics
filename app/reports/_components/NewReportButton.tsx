"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type CreateReportResponse = {
  ok: boolean;
  report?: {
    report_id: string;
    route: string;
  };
  error?: string;
};

export default function NewReportButton() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createReport() {
    if (creating) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/editor/report", {
        method: "POST",
      });
      const json = (await res.json()) as CreateReportResponse;
      if (!res.ok || !json.ok || !json.report?.report_id) {
        throw new Error(json.error || "Failed to create report");
      }
      router.push(`/reports/${encodeURIComponent(json.report.report_id)}/edit`);
    } catch (err: unknown) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs" style={{ color: "var(--app-danger, #b91c1c)" }}>
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => void createReport()}
        disabled={creating}
        className="inline-flex h-8 w-8 items-center justify-center rounded border text-lg font-semibold leading-none"
        style={{
          borderColor: "var(--app-border)",
          color: "var(--app-text-strong)",
          backgroundColor: "var(--app-surface)",
        }}
        aria-label="Create report"
        title="Create report"
      >
        {creating ? "..." : "+"}
      </button>
    </div>
  );
}
