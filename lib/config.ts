export type RuntimeConfig = {
  supabaseUrl: string;
  supabaseKey: string;
  allowedTables: Set<string>;
  mcpApiKey: string;
};

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseKey =
    env.SUPABASE_SECRET_KEY?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const mcpApiKey = env.MCP_API_KEY?.trim();
  const tableNames = env.SUPABASE_ALLOWED_TABLES
    ?.split(",")
    .map((table) => table.trim())
    .filter(Boolean);

  if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
  try {
    const url = new URL(supabaseUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTP or HTTPS URL");
  }
  if (!supabaseKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required",
    );
  }
  if (supabaseKey.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SECRET_KEY cannot use a publishable key",
    );
  }
  if (!mcpApiKey) throw new Error("MCP_API_KEY is required");
  if (mcpApiKey.length < 32) {
    throw new Error("MCP_API_KEY must be at least 32 characters");
  }
  if (
    !tableNames?.length ||
    tableNames.some((table) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table))
  ) {
    throw new Error(
      "SUPABASE_ALLOWED_TABLES must be a comma-separated list of table names",
    );
  }

  return {
    supabaseUrl,
    supabaseKey,
    allowedTables: new Set(tableNames),
    mcpApiKey,
  };
}
