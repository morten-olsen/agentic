import { DynamicStructuredTool } from '@langchain/core/tools';
import { toJSONSchema, type ZodType } from 'zod';

import type { RegisteredTool, ToolContext, ToolRegistry } from '../tools.ts';

/**
 * Converts a GLaDOS tool to a LangChain DynamicStructuredTool.
 */
const toLangChainTool = <TInput, TOutput>(
  tool: RegisteredTool<TInput, TOutput>,
  context: ToolContext,
): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: tool.id,
    description: tool.description,
    schema: tool.inputSchema,
    func: async (input: TInput): Promise<string> => {
      const result = await tool.execute(input, context);
      return typeof result === 'string' ? result : JSON.stringify(result);
    },
  });
};

/**
 * Converts all tools from a registry to LangChain tools.
 */
const toLangChainTools = (registry: ToolRegistry, context: ToolContext): DynamicStructuredTool[] => {
  return registry.getAll().map((tool) => toLangChainTool(tool, context));
};

/**
 * Converts selected tools from a registry to LangChain tools.
 */
const toLangChainToolsFiltered = (
  registry: ToolRegistry,
  context: ToolContext,
  filter: (tool: RegisteredTool) => boolean,
): DynamicStructuredTool[] => {
  return registry
    .getAll()
    .filter(filter)
    .map((tool) => toLangChainTool(tool, context));
};

/**
 * Converts tools by category to LangChain tools.
 */
const toLangChainToolsByCategory = (
  registry: ToolRegistry,
  context: ToolContext,
  category: string,
): DynamicStructuredTool[] => {
  return registry.getByCategory(category).map((tool) => toLangChainTool(tool, context));
};

/**
 * Converts tools by tag to LangChain tools.
 */
const toLangChainToolsByTag = (registry: ToolRegistry, context: ToolContext, tag: string): DynamicStructuredTool[] => {
  return registry.getByTag(tag).map((tool) => toLangChainTool(tool, context));
};

/**
 * Gets the JSON schema representation of a tool's input schema.
 * Useful for documentation or API endpoints.
 */
const getToolJsonSchema = (tool: RegisteredTool): object => {
  return toJSONSchema(tool.inputSchema as ZodType);
};

export {
  toLangChainTool,
  toLangChainTools,
  toLangChainToolsFiltered,
  toLangChainToolsByCategory,
  toLangChainToolsByTag,
  getToolJsonSchema,
};
