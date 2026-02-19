// lib/auth.ts
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

  // Optional: update last_login_at
  await pool.query(`UPDATE auth."user" SET last_login_at = now() WHERE sis_user_id = $1`, [u.sis_user_id]);

  return {
    sis_user_id: u.sis_user_id,
    email: u.email,
    display_name: u.display_name,
    is_admin: u.is_admin,
  };
}
