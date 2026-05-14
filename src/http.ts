import "dotenv/config";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { loadConfig } from "./config.js";
import { createShitMinterMcpServer } from "./mcp.js";

type HttpRequest = {
  body?: unknown;
  header(name: string): string | undefined;
};

type HttpResponse = {
  headersSent: boolean;
  json(value: unknown): void;
  status(code: number): HttpResponse;
};

const config = loadConfig();
const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
const port = Number(process.env.MCP_HTTP_PORT ?? process.env.PORT ?? "3000");
const allowedHosts = process.env.MCP_ALLOWED_HOSTS
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const app = createMcpExpressApp({ host, allowedHosts });

app.get("/healthz", (_req: HttpRequest, res: HttpResponse) => {
  res.json({
    ok: true,
    service: "sui-mcp-shit-minter",
    transport: "streamable-http",
    network: config.SUI_NETWORK
  });
});

app.post("/mcp", async (req: HttpRequest, res: HttpResponse) => {
  if (!config.PUBLIC_MCP && !isAuthorizedHttpRequest(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const server = createShitMinterMcpServer(config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req as never, res as never, req.body);
  } catch (error) {
    console.error("Error handling MCP HTTP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  } finally {
    await transport.close();
    await server.close();
  }
});

app.get("/mcp", (_req: HttpRequest, res: HttpResponse) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  });
});

app.delete("/mcp", (_req: HttpRequest, res: HttpResponse) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  });
});

app.listen(port, host, (error?: Error) => {
  if (error) {
    console.error("Failed to start MCP HTTP server:", error);
    process.exit(1);
  }

  console.log(`MCP HTTP server listening at http://${host}:${port}/mcp`);
});

function isAuthorizedHttpRequest(req: HttpRequest): boolean {
  if (!config.MCP_OAUTH_BEARER_TOKEN) {
    return true;
  }

  const authorization = req.header("authorization");
  return authorization === `Bearer ${config.MCP_OAUTH_BEARER_TOKEN}`;
}
