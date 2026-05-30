import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "./server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(express.json({ limit: "1mb" }));

const transports = new Map<string, StreamableHTTPServerTransport>();

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "x-f1-mcp" });
});

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string): void => { transports.set(id, transport); },
      enableDnsRebindingProtection: false,
    });

    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };

    const server = await createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Bad Request" },
    id: null,
  });
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // No session ID = connector health check (e.g. Perplexity probing the endpoint)
  if (!sessionId) {
    res.status(200).json({ ok: true, service: "x-f1-mcp", transport: "streamable-http" });
    return;
  }

  if (!transports.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  await transports.get(sessionId)!.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports.get(sessionId)!.handleRequest(req, res);
});

app.listen(port, () => {
  console.log(`x-f1-mcp listening on port ${port}`);
});
