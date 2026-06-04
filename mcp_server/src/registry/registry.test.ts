import { mock } from "bun:test";
mock.module("exa-js", () => ({ default: class Exa {} }));
mock.module("./tools/character_save.js", () => ({ register: () => {} }));
mock.module("./tools/character_list.js", () => ({ register: () => {} }));
mock.module("./tools/character_update.js", () => ({ register: () => {} }));
mock.module("./tools/character_delete.js", () => ({ register: () => {} }));
mock.module("./tools/character_search.js", () => ({ register: () => {} }));
mock.module("./tools/character_db_search.js", () => ({ register: () => {} }));
mock.module("./tools/show_search.js", () => ({ register: () => {} }));
mock.module("./tools/conversation_start.js", () => ({ register: () => {} }));
mock.module("./tools/conversation_job_status.js", () => ({ register: () => {} }));
mock.module("./tools/scene_simulate.js", () => ({ register: () => {} }));
mock.module("../exa.js", () => ({ exa: {} }));

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
