import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";

type UserSettingsRow = {
  dark_mode: boolean | null;
  anonymize: boolean | null;
};

type UserSettingsPayload = {
  dark_mode: boolean;
  anonymize: boolean;
};

function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

export async function GET() {
  try {
    const payload = await withAuthedDb(async ({ db, user }) => {
      const { rows } = await db.query<UserSettingsRow>(
        `
        SELECT dark_mode, anonymize
        FROM auth.user_settings
        WHERE sis_user_id = $1
        LIMIT 1
        `,
        [user.sis_user_id]
      );

      const settings = rows[0];
      return {
        ok: true,
        settings: {
          dark_mode: toBool(settings?.dark_mode, false),
          anonymize: toBool(settings?.anonymize, false),
        },
      };
    });

    return NextResponse.json(payload);
  } catch (e: unknown) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }
    console.error("User settings GET error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<UserSettingsPayload>;
    const darkMode = toBool(body?.dark_mode, false);
    const anonymize = toBool(body?.anonymize, false);

    const payload = await withAuthedDb(async ({ db, user }) => {
      const { rows } = await db.query<UserSettingsRow>(
        `
        INSERT INTO auth.user_settings (sis_user_id, dark_mode, anonymize)
        VALUES ($1, $2, $3)
        ON CONFLICT (sis_user_id) DO UPDATE
          SET dark_mode = EXCLUDED.dark_mode,
              anonymize = EXCLUDED.anonymize
        RETURNING dark_mode, anonymize
        `,
        [user.sis_user_id, darkMode, anonymize]
      );

      const settings = rows[0];
      return {
        ok: true,
        settings: {
          dark_mode: toBool(settings?.dark_mode, darkMode),
          anonymize: toBool(settings?.anonymize, anonymize),
        },
      };
    });

    return NextResponse.json(payload);
  } catch (e: unknown) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }
    console.error("User settings PUT error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
