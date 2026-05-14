import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createShitMinterMcpServer } from "./mcp.js";

const config = loadConfig();
const server = createShitMinterMcpServer(config);

const transport = new StdioServerTransport();
await server.connect(transport);
