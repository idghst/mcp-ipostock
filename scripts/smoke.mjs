import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.argv[2] || process.env.MCP_URL;
const apiKey = process.env.MCP_API_KEY;

if (!endpoint || !apiKey) {
  console.error(
    [
      "Usage: MCP_API_KEY=<key> npm run smoke -- https://<project>.vercel.app/mcp",
      "Optional: MCP_SMOKE_TABLE=<table> MCP_SMOKE_MIN_ROWS=1",
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  let client;

  try {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("MCP URL must use HTTP or HTTPS");
    }

    client = new Client({
      name: "mcp-ipostock-smoke",
      version: "0.1.0",
    });

    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      },
    });

    await client.connect(transport);
    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name).sort();
    const expectedTools = [
      "describe_table",
      "insert_rows",
      "select_rows",
      "update_rows",
    ];

    for (const expectedTool of expectedTools) {
      if (!toolNames.includes(expectedTool)) {
        throw new Error(`Missing MCP tool: ${expectedTool}`);
      }
    }

    const smokeTable = process.env.MCP_SMOKE_TABLE?.trim();
    let schemaColumns = null;
    let databaseRows = null;
    if (smokeTable) {
      const parseResult = (result, label) => {
        const text = result.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
        if (result.isError) {
          throw new Error(text || `${label} failed`);
        }
        try {
          return JSON.parse(text);
        } catch {
          throw new Error(`${label} returned invalid JSON`);
        }
      };

      const description = parseResult(
        await client.callTool({
          name: "describe_table",
          arguments: { table: smokeTable },
        }),
        "Supabase schema probe",
      );
      if (!Array.isArray(description.columns)) {
        throw new Error("Supabase schema probe returned invalid columns");
      }
      schemaColumns = description.columns.length;

      const rows = parseResult(await client.callTool({
        name: "select_rows",
        arguments: { table: smokeTable, limit: 1 },
      }), "Supabase read probe");
      if (!Array.isArray(rows)) {
        throw new Error("Supabase read probe returned invalid rows");
      }
      databaseRows = rows.length;

      const minimumText = process.env.MCP_SMOKE_MIN_ROWS?.trim();
      if (minimumText) {
        const minimum = Number(minimumText);
        if (!Number.isSafeInteger(minimum) || minimum < 0) {
          throw new Error(
            "MCP_SMOKE_MIN_ROWS must be a non-negative integer",
          );
        }
        if (databaseRows < minimum) {
          throw new Error(
            `Supabase read probe returned ${databaseRows} rows; expected at least ${minimum}`,
          );
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          endpoint: url.toString(),
          tools: toolNames,
          databaseProbe: smokeTable || "skipped",
          schemaColumns,
          databaseRows,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await client?.close().catch(() => undefined);
  }
}
