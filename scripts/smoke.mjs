import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.argv[2] || process.env.MCP_URL;
const apiKey = process.env.MCP_API_KEY;

if (!endpoint || !apiKey) {
  console.error(
    "Usage: MCP_API_KEY=<key> npm run smoke -- https://<project>.vercel.app/mcp",
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
    const expectedTools = ["insert_rows", "select_rows", "update_rows"];

    for (const expectedTool of expectedTools) {
      if (!toolNames.includes(expectedTool)) {
        throw new Error(`Missing MCP tool: ${expectedTool}`);
      }
    }

    const smokeTable = process.env.MCP_SMOKE_TABLE?.trim();
    if (smokeTable) {
      const result = await client.callTool({
        name: "select_rows",
        arguments: { table: smokeTable, limit: 1 },
      });

      if (result.isError) {
        const message = result.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
        throw new Error(message || "Supabase read probe failed");
      }
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          endpoint: url.toString(),
          tools: toolNames,
          databaseProbe: smokeTable || "skipped",
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
