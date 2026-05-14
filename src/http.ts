import "dotenv/config";
import { readFileSync } from "node:fs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { loadConfig } from "./config.js";
import { createShitMinterMcpServer } from "./mcp.js";
import { loadSponsorKeypair } from "./sponsor.js";
import {
  assertPackageObjectsExist,
  createSuiClient,
  getUserMintStatus,
  prepareSponsoredMintTransaction,
  submitSponsoredMintTransaction
} from "./sui.js";

type HttpRequest = {
  body?: unknown;
  header(name: string): string | undefined;
};

type HttpResponse = {
  headersSent: boolean;
  json(value: unknown): void;
  send(value: string): void;
  status(code: number): HttpResponse;
  type(value: string): HttpResponse;
};

const config = loadConfig();
const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
const port = Number(process.env.MCP_HTTP_PORT ?? process.env.PORT ?? "3000");
const allowedHosts = process.env.MCP_ALLOWED_HOSTS
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const app = createMcpExpressApp({ host, allowedHosts });
const client = createSuiClient(config);

app.get("/", (_req: HttpRequest, res: HttpResponse) => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  res.type("html").send(html);
});

app.get("/healthz", (_req: HttpRequest, res: HttpResponse) => {
  res.json({
    ok: true,
    service: "sui-mcp-shit-minter",
    transport: "streamable-http",
    network: config.SUI_NETWORK
  });
});

app.get("/api/mint-status", async (req: HttpRequest & { query?: Record<string, unknown> }, res: HttpResponse) => {
  try {
    const userAddress = String(req.query?.address ?? "");
    assertSuiAddress(userAddress);
    await assertPackageObjectsExist(client, config);
    res.json({ ok: true, ...(await getUserMintStatus(client, config, userAddress)) });
  } catch (error) {
    sendJsonError(res, error);
  }
});

app.post("/api/prepare-sponsored-mint", async (req: HttpRequest, res: HttpResponse) => {
  try {
    const userAddress = getBodyString(req.body, "userAddress");
    assertSuiAddress(userAddress);
    await assertPackageObjectsExist(client, config);

    const sponsor = loadSponsorKeypair(config).toSuiAddress();
    const transactionBlock = await prepareSponsoredMintTransaction(client, config, userAddress, sponsor);
    res.json({
      ok: true,
      network: config.SUI_NETWORK,
      signer: userAddress,
      recipient: userAddress,
      sponsor,
      transactionBlock,
      expectedMintAmount: "10000000",
      expectedSymbol: "SHIT"
    });
  } catch (error) {
    sendJsonError(res, error);
  }
});

app.post("/api/submit-sponsored-mint", async (req: HttpRequest, res: HttpResponse) => {
  try {
    const userAddress = getBodyString(req.body, "userAddress");
    const transactionBlock = getBodyString(req.body, "transactionBlock");
    const userSignature = getBodyString(req.body, "userSignature");
    assertSuiAddress(userAddress);

    const sponsor = loadSponsorKeypair(config);
    const expectedTransactionBlock = await prepareSponsoredMintTransaction(client, config, userAddress, sponsor.toSuiAddress());
    if (transactionBlock !== expectedTransactionBlock) {
      throw new Error("Transaction block does not match the expected sponsored mint for this wallet. Prepare a fresh transaction.");
    }

    const result = await submitSponsoredMintTransaction(client, sponsor, transactionBlock, userSignature);
    res.json({
      ok: true,
      digest: result.digest,
      status: result.effects?.status,
      balanceChanges: result.balanceChanges,
      objectChanges: result.objectChanges
    });
  } catch (error) {
    sendJsonError(res, error);
  }
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

function getBodyString(body: unknown, key: string): string {
  if (!body || typeof body !== "object") {
    throw new Error("Expected JSON request body.");
  }

  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required field: ${key}`);
  }

  return value;
}

function assertSuiAddress(address: string): void {
  if (!/^0x[a-fA-F0-9]+$/.test(address)) {
    throw new Error("Invalid Sui address.");
  }
}

function sendJsonError(res: HttpResponse, error: unknown): void {
  res.status(400).json({
    ok: false,
    error: error instanceof Error ? error.message : "Unknown error"
  });
}
