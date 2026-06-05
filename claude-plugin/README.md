# OpenOrmus Claude Code Plugin

Extends Claude Code and Claude desktop with full [OpenOrmus](https://github.com/andreolli-davide/open-ormus) integration — create characters, simulate multi-character conversations, and evaluate LLM behavioural fidelity.

## Requirements

- OpenOrmus running locally or deployed (MCP server + frontend)
- Claude Code v2.1+ (for OAuth 2.0 support)

## Installation

```bash
claude plugin install /path/to/claude-plugin
# or from the repository root:
claude --plugin-dir ./claude-plugin
```

## Configuration

Set `OPENORMUS_URL` in your shell to point to your OpenOrmus instance:

```bash
export OPENORMUS_URL=http://localhost:3001   # local dev (default)
export OPENORMUS_URL=https://mcp.myapp.com  # deployed instance
```

## Authentication

On first use, Claude Code will open your browser to sign in with your OpenOrmus account. Tokens are stored and refreshed automatically.

## Skills

| Skill | Command | What it does |
|---|---|---|
| Create character | `/openormus:create-character` | Build a character profile and save it |
| Import from show | `/openormus:import-from-show` | Bulk-import characters from a franchise |
| Start conversation | `/openormus:start-conversation` | Launch a multi-character scene |
| Manage characters | `/openormus:manage-characters` | List, update, or delete characters |
| Research character | `/openormus:research-character` | Preview a character before saving |
| Evaluate conversation | `/openormus:evaluate-conversation` | Score character fidelity in a completed conversation |
| Generate dataset | `/openormus:generate-dataset` | Build an evaluation dataset from conversations |
| Improve context | `/openormus:improve-context` | Craft a better scene context |
| Archive character | `/openormus:archive-character` | Soft-delete a character |

## Development

```bash
claude --plugin-dir ./claude-plugin
```

Reload after changes:
```
/reload-plugins
```
