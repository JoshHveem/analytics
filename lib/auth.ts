// lib/auth.ts
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { pool } from "./db";

export type AuthUser = {
  sis_user_id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
};

export class HttpError extends Error {
  status: number;
  payload: any;

  constructor(status: number, payload: any) {
    super(payload?.error || "HttpError");
    this.status = status;
    this.payload = payload;
  }
}

function getCookieValue(cookieHeader: string, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k?.toLowerCase() === name.toLowerCase()) {
      return rest.join("=").trim() || null;
    }
  }
  return null;
}

function getAuthSessionFingerprint(cookieHeader: string): string | null {
  // Prefer stable SSO/session cookies when present.
  const candidates = [
    "sessionid",
    "_session",
    "auth_session",
    "__session",
    "csrftoken",
  ];

  for (const name of candidates) {
    const value = getCookieValue(cookieHeader, name);
    if (value) {
      return createHash("sha256").update(`${name}:${value}`).digest("hex").slice(0, 24);
    }
  }

  return null;
}

export async function requireAuth(): Promise<AuthUser> {
  const h = await headers(); // ✅ IMPORTANT: headers() is async in your Next version

  // Read X-Email header (case-insensitive)
  let emailRaw = (h.get("x-email") || "").trim();

  // Dev-only bypass (SKIP_AUTH=true in .env.local)
  if (!emailRaw && process.env.SKIP_AUTH === "true" && process.env.NODE_ENV !== "production") {
    emailRaw = (process.env.DEV_EMAIL || "").trim();
  }

  const email = emailRaw.toLowerCase();

  if (!email) {
    throw new HttpError(401, { error: "Unauthorized: missing X-Email header" });
  }

  if (!email.endsWith("@btech.edu")) {
    throw new HttpError(403, { error: "Forbidden: must be @btech.edu" });
  }

  const { rows } = await pool.query(
    `
    SELECT sis_user_id, email, display_name, is_active, is_admin
    FROM auth."user"
    WHERE lower(email) = $1
    LIMIT 1
    `,
    [email]
  );

  if (rows.length === 0) {
    throw new HttpError(403, {
      error: "Access not provisioned",
      message: "Your account is not enabled for analytics. Contact isd@btech.edu.",
    });
  }

  const u = rows[0];

  if (!u.is_active) {
    throw new HttpError(403, {
      error: "Account disabled",
      message: "Your analytics account is disabled. Contact isd@btech.edu.",
    });
  }

  const forwardedFor = (h.get("x-forwarded-for") || "").trim();
  const clientIp = forwardedFor
    ? forwardedFor.split(",")[0]?.trim() || null
    : (h.get("x-real-ip") || "").trim() || null;
  const userAgent = (h.get("user-agent") || "").trim() || null;
  const cookieHeader = h.get("cookie") || "";
  const sessionFingerprint = getAuthSessionFingerprint(cookieHeader);
  const sourceBase = process.env.SKIP_AUTH === "true" && process.env.NODE_ENV !== "production"
    ? "dev-skip-auth"
    : "web";
  const source = sessionFingerprint ? `${sourceBase}:session:${sessionFingerprint}` : null;

  // Optional: track login event once per auth session fingerprint.
  if (source) {
    try {
      await pool.query(
        `
        INSERT INTO auth.user_login (sis_user_id, login_at, ip_address, user_agent, source, success, email)
        SELECT $1, now(), NULLIF($3, '')::inet, $4, $5, true, $2
        WHERE NOT EXISTS (
          SELECT 1
          FROM auth.user_login ul
          WHERE ul.sis_user_id = $1
            AND ul.source = $5
            AND ul.success = true
        )
        `,
        [u.sis_user_id, u.email, clientIp ?? "", userAgent, source]
      );
    } catch (e) {
      console.warn("Auth warning: unable to write user_login event", {
        sis_user_id: u.sis_user_id,
        error: e,
      });
    }
  }

  return {
    sis_user_id: u.sis_user_id,
    email: u.email,
    display_name: u.display_name,
    is_admin: Boolean(u.is_admin),
  };
}
