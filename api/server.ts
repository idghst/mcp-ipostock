import { createClient } from "@supabase/supabase-js";
import { createMcpHandler } from "mcp-handler";

import { loadConfig } from "../lib/config.ts";
import { createDatabaseGateway } from "../lib/database.ts";
import { isAuthorized } from "../lib/security.ts";
import { registerSupabaseTools } from "../lib/tools.ts";

let mcpHandler: ReturnType<typeof createMcpHandler> | undefined;

function getMcpHandler() {
  mcpHandler ??= createMcpHandler(
    (server) => {
      const config = loadConfig();
      const client = createClient(config.supabaseUrl, config.supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      });
      registerSupabaseTools(
        server,
        createDatabaseGateway(client, config.allowedTables),
        config.allowedTables,
      );
    },
    {
      serverInfo: {
        name: "supabase-crud",
        version: "0.1.0",
      },
    },
    {
      maxDuration: 60,
      disableSse: true,
    },
  );
  return mcpHandler;
}

async function authenticatedHandler(request: Request) {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Server is not configured",
      },
      { status: 503 },
    );
  }

  if (!isAuthorized(request.headers.get("authorization"), config.mcpApiKey)) {
    return Response.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      },
    );
  }

  return getMcpHandler()(request);
}

export {
  authenticatedHandler as DELETE,
  authenticatedHandler as GET,
  authenticatedHandler as POST,
};
