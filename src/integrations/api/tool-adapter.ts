import { toJSONSchema, type ZodType } from 'zod';

import type { RegisteredTool } from '../../agent/tools/tools.types.ts';
import { isDynamicRiskProfile, type RiskProfile } from '../../agent/tools/tools.schemas.ts';

import type { ToolInfo } from './api.schemas.ts';

// ============================================================================
// Schema Conversion
// ============================================================================

/**
 * Converts a Zod schema to JSON Schema for OpenAPI documentation.
 * Uses Zod 4's native toJSONSchema function.
 */
const zodSchemaToJsonSchema = (schema: unknown, name: string): Record<string, unknown> => {
  try {
    // Use Zod 4's native toJSONSchema
    return toJSONSchema(schema as ZodType) as Record<string, unknown>;
  } catch {
    // Fallback for complex schemas that don't convert well
    return {
      type: 'object',
      description: `Schema for ${name}`,
    };
  }
};

// ============================================================================
// Risk Evaluation
// ============================================================================

/**
 * Gets the effective risk profile for a tool.
 * For dynamic risk profiles, returns the default profile.
 */
const getEffectiveRiskProfile = (tool: RegisteredTool): RiskProfile => {
  if (isDynamicRiskProfile(tool.risk)) {
    return tool.risk.defaultProfile;
  }
  return tool.risk;
};

/**
 * Checks if a tool should be exposed via the API.
 * Only low and medium risk tools are exposed by default.
 */
const isToolExposedViaApi = (tool: RegisteredTool): boolean => {
  const risk = getEffectiveRiskProfile(tool);
  return risk.level === 'low' || risk.level === 'medium';
};

// ============================================================================
// Tool Info Conversion
// ============================================================================

/**
 * Converts a RegisteredTool to the API ToolInfo format.
 */
const toolToApiInfo = (tool: RegisteredTool): ToolInfo => {
  const risk = getEffectiveRiskProfile(tool);

  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    tags: tool.tags,
    inputSchema: zodSchemaToJsonSchema(tool.inputSchema, `${tool.name}Input`),
    outputSchema: zodSchemaToJsonSchema(tool.outputSchema, `${tool.name}Output`),
    risk,
    examples: tool.examples.map((ex) => ({
      input: ex.input as Record<string, unknown>,
      description: ex.description,
    })),
    requiredServices: tool.requiredServices,
  };
};

// ============================================================================
// Tool Filtering
// ============================================================================

/**
 * Filters tools by category.
 */
const filterByCategory = (tools: RegisteredTool[], category: string): RegisteredTool[] => {
  return tools.filter((tool) => tool.category === category);
};

/**
 * Filters tools by tag.
 */
const filterByTag = (tools: RegisteredTool[], tag: string): RegisteredTool[] => {
  return tools.filter((tool) => tool.tags.includes(tag));
};

/**
 * Filters tools to only those exposed via API.
 */
const filterExposedTools = (tools: RegisteredTool[]): RegisteredTool[] => {
  return tools.filter(isToolExposedViaApi);
};

// ============================================================================
// Exports
// ============================================================================

export {
  zodSchemaToJsonSchema,
  getEffectiveRiskProfile,
  isToolExposedViaApi,
  toolToApiInfo,
  filterByCategory,
  filterByTag,
  filterExposedTools,
};
