import type { AgentRole } from '../types/agents.js';

/**
 * Local agent CLIs that can run a role (ADR 0005). A preset is the command a
 * role needs: the explorer and the judge act only through the Bugpatrol MCP
 * tools, so their command loads `{mcp}` and pre-approves those tools; the
 * fixer edits files in its worktree, so its command allows edits there.
 *
 * `use: claude` in bugpatrol.yml expands to the preset for that role. A
 * `command` wins over the preset, for teams that need extra flags.
 */
export const CLI_AGENTS = ['claude', 'codex', 'kimi', 'pi'] as const;
export type CliAgent = (typeof CLI_AGENTS)[number];

const PRESETS: Record<CliAgent, { tools: string; fixer: string }> = {
  claude: {
    tools: 'claude -p --output-format json --mcp-config {mcp} --strict-mcp-config --allowedTools mcp__bugpatrol',
    fixer: 'claude -p --output-format json --permission-mode acceptEdits',
  },
  // `-c` parses its value as TOML and keeps a bare URL as a string.
  codex: {
    tools: 'codex exec --json --skip-git-repo-check -c mcp_servers.bugpatrol.url={mcpUrl} -',
    fixer: 'codex exec --json --skip-git-repo-check --sandbox workspace-write -',
  },
  // Print mode approves tool calls on its own. The inline config gives kimi
  // only the URL, in the form its MCP loader expects.
  kimi: {
    tools: `kimi --quiet --mcp-config '{"mcpServers":{"bugpatrol":{"url":"'{mcpUrl}'"}}}'`,
    fixer: 'kimi --quiet --yolo',
  },
  // pi has no MCP of its own: `--mcp-config` comes from the pi-mcp-adapter
  // extension (`pi install npm:pi-mcp-adapter`).
  pi: {
    tools: 'pi -p --no-session --mcp-config {mcp}',
    fixer: 'pi -p --no-session',
  },
};

export function cliPreset(agent: CliAgent, role: AgentRole): string {
  return role === 'fixer' ? PRESETS[agent].fixer : PRESETS[agent].tools;
}
