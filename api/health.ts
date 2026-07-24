import { loadConfig } from "../lib/config.ts";

export async function GET(_request: Request) {
  try {
    loadConfig();
    return Response.json(
      { status: "ok", service: "supabase-crud-mcp" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        status: "error",
        error:
          error instanceof Error ? error.message : "Server is not configured",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
