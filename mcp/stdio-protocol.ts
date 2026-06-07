import type { EmailMcpService } from "../service/email-mcp-service";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export function handleMcpJsonRpcLine(service: EmailMcpService, line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let request: JsonRpcRequest;
  try {
    request = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    return JSON.stringify(errorResponse(null, -32700, "Parse error"));
  }

  if (request.id === undefined && request.method?.startsWith("notifications/")) {
    return null;
  }

  switch (request.method) {
    case "initialize":
      return JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "email-mcp", version: "0.1.0" }
        }
      });
    case "tools/list":
      return JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: service.listTools() } });
    case "tools/call":
      return JSON.stringify({ jsonrpc: "2.0", id: request.id, result: callTool(service, request.params) });
    default:
      return JSON.stringify(errorResponse(request.id ?? null, -32601, "Method not found"));
  }
}

function callTool(service: EmailMcpService, params: Record<string, unknown> | undefined) {
  const name = typeof params?.name === "string" ? params.name : "";
  const args = isRecord(params?.arguments) ? params.arguments : {};
  const payload = service.callTool(name, args);
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: !payload.ok
  };
}

function errorResponse(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
