import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { Tool } from './types.js';

/** Advertised schemas are enforcement rules for both model and MCP dispatch. */
export function validateTools(tools: Tool[]): Tool[] {
  const validator = new AjvJsonSchemaValidator();
  return tools.map((tool) => {
    const validate = validator.getValidator<Record<string, unknown>>(tool.inputSchema);
    return { ...tool, async run(input: Record<string, unknown>, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const checked = validate(input);
      if (!checked.valid) return { content: [{ type: 'text' as const, text: `Invalid arguments: ${checked.errorMessage}` }], isError: true };
      return tool.run(checked.data, signal);
    } };
  });
}
