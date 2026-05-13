import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerCharacterCreate } from "./tools/character_create.js";
import { register as registerCharacterGet } from "./tools/character_get.js";
import { register as registerCharacterSearch } from "./tools/character_search.js";
import { register as registerShowSearch } from "./tools/show_search.js";
import { register as registerSceneSimulate } from "./tools/scene_simulate.js";

export function createRegistry(): McpServer {
  const server = new McpServer({
    name: "open-ormus",
    version: "0.0.1",
  });

  registerCharacterCreate(server);
  registerCharacterGet(server);
  registerCharacterSearch(server);
  registerShowSearch(server);
  registerSceneSimulate(server);

  return server;
}
