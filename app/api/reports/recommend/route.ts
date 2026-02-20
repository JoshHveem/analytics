import { NextResponse } from "next/server";
import { withAuthedDb } from "@/lib/authed-db";
import { HttpError } from "@/lib/auth";

type ReportRecord = {
  id: string;
  title: string;
  category: string;
  route: string;
  description: string | null;
  tags: string[];
};

type Recommendation = {
  route: string;
  reason: string;
  confidence?: number;
};

function normalizeRoute(route: string): string {
  return String(route ?? "").trim().replace(/^\/+|\/+$/g, "");
}

function toTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .replace(/[{}"]/g, "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

async function getActiveReportsWithTags(): Promise<ReportRecord[]> {
  return withAuthedDb(async ({ db }) => {
    const { rows } = await db.query<{
      id: string;
      title: string;
      category: string;
      route: string;
      description: string | null;
      tags: unknown;
    }>(
      `
      SELECT id, title, category, route, description, tags
      FROM meta.reports
      WHERE is_active = true
      ORDER BY lower(category), lower(title)
      `
    );

    return rows
      .map((row: { id: string; title: string; category: string; route: string; description: string | null; tags: unknown }) => {
        const route = normalizeRoute(row.route);
        return {
          id: String(row.id),
          title: String(row.title ?? route),
          category: String(row.category ?? "").trim().toLowerCase(),
          route,
          description: row.description ?? null,
          tags: toTags(row.tags),
        };
      })
      .filter((row: { route: string }) => row.route.length > 0);
  });
}

function tryParseJson(input: string): Recommendation[] | null {
  const trimmed = input.trim();
  const cleaned = trimmed.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { recommendations?: Recommendation[] };
    if (!Array.isArray(parsed.recommendations)) {
      return null;
    }
    return parsed.recommendations
      .map((item) => ({
        route: normalizeRoute(item.route),
        reason: String(item.reason ?? "").trim(),
        confidence:
          typeof item.confidence === "number" && Number.isFinite(item.confidence)
            ? Math.max(0, Math.min(1, item.confidence))
            : undefined,
      }))
      .filter((item) => item.route && item.reason);
  } catch {
    return null;
  }
}

function scoreReportsFallback(query: string, reports: ReportRecord[]): Recommendation[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);

  if (tokens.length === 0) {
    return reports.slice(0, 3).map((report) => ({
      route: report.route,
      reason: "General top active report.",
      confidence: 0.2,
    }));
  }

  const scored = reports
    .map((report) => {
      const text = [
        report.title.toLowerCase(),
        report.category.toLowerCase(),
        report.route.toLowerCase(),
        (report.description ?? "").toLowerCase(),
        report.tags.join(" ").toLowerCase(),
      ].join(" ");
      const hits = tokens.filter((token) => text.includes(token)).length;
      return { report, hits };
    })
    .filter((row) => row.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5);

  if (scored.length === 0) {
    return reports.slice(0, 3).map((report) => ({
      route: report.route,
      reason: "No exact match found; this is a broad-fit active report.",
      confidence: 0.15,
    }));
  }

  return scored.map((row) => ({
    route: row.report.route,
    reason: "Matched your search terms against report metadata.",
    confidence: Math.min(1, row.hits / Math.max(1, tokens.length)),
  }));
}

async function getAiRecommendations(
  query: string,
  reports: ReportRecord[]
): Promise<Recommendation[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const catalog = reports.map((report) => ({
    title: report.title,
    category: report.category,
    route: report.route,
    description: report.description,
    tags: report.tags,
  }));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You rank reports for a dashboard search. Return strict JSON only with shape {\"recommendations\":[{\"route\":\"...\",\"reason\":\"...\",\"confidence\":0.0}]}. Confidence must be 0..1.",
        },
        {
          role: "user",
          content: `User request: ${query}\n\nReport catalog:\n${JSON.stringify(catalog)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  return tryParseJson(content);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown };
    const query = String(body?.query ?? "").trim();
    if (!query) {
      throw new HttpError(400, { error: "Missing required field: query" });
    }

    const reports = await getActiveReportsWithTags();
    if (reports.length === 0) {
      return NextResponse.json({ ok: true, recommendations: [] });
    }

    let ranked: Recommendation[] | null = null;
    let usedAi = false;
    try {
      ranked = await getAiRecommendations(query, reports);
      usedAi = Boolean(ranked && ranked.length > 0);
    } catch (error) {
      console.error("AI recommendation error:", error);
    }
    if (!ranked || ranked.length === 0) {
      ranked = scoreReportsFallback(query, reports);
    }

    const reportsByRoute = new Map(reports.map((report) => [report.route, report]));
    const recommendations = ranked
      .map((item) => {
        const report = reportsByRoute.get(item.route);
        if (!report) {
          return null;
        }
        return {
          id: report.id,
          title: report.title,
          category: report.category,
          route: report.route,
          href: `/reports/${report.route}`,
          description: report.description,
          reason: item.reason,
          confidence: item.confidence ?? null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 5);

    return NextResponse.json({
      ok: true,
      recommendations,
      used_ai: usedAi,
    });
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    console.error("Report recommendation route error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
