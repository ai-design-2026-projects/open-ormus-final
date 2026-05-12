import { describe, test, expect } from "bun:test";
import { createRegistry } from "./registry";

describe("createRegistry", () => {
  test("returns an McpServer instance", () => {
    const server = createRegistry();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  test("server name is open-ormus", () => {
    const server = createRegistry();
    // McpServer v1.29: the name is on the inner Server instance (server.server._serverInfo).
    // _serverInfo does not exist directly on McpServer — it lives one level down.
    const info = (
      server as unknown as { server: { _serverInfo: { name: string } } }
    ).server._serverInfo;
    expect(info.name).toBe("open-ormus");
  });
});
