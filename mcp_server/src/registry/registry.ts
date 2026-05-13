import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerCharacterSave } from "./tools/character_save.js";
import { register as registerCharacterList } from "./tools/character_list.js";
import { register as registerCharacterUpdate } from "./tools/character_update.js";
import { register as registerCharacterDelete } from "./tools/character_delete.js";
import { register as registerCharacterSearch } from "./tools/character_search.js";
import { register as registerShowSearch } from "./tools/show_search.js";
import { register as registerSceneSimulate } from "./tools/scene_simulate.js";

export function createRegistry(): McpServer {
  const server = new McpServer({
    name: "open-ormus",
    version: "0.0.1",
  });

  registerCharacterSave(server);
  registerCharacterList(server);
  registerCharacterUpdate(server);
  registerCharacterDelete(server);
  registerCharacterSearch(server);
  registerShowSearch(server);
  registerSceneSimulate(server);

  return server;
}
