import { NextResponse } from "next/server";
import { userClient } from "@/lib/server";
export async function GET(request: Request) {
  const url = new URL(request.url),
    code = url.searchParams.get("code");
  if (code) {
    const db = await userClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(
          url.searchParams.get("reset") === "1" ? "/?reset=1" : "/",
          process.env.APP_URL!,
        ),
      );
  }
  return NextResponse.redirect(
    new URL("/?auth_error=1", process.env.APP_URL || url.origin),
  );
}
