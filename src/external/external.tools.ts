import type { ToolRegistry, RegisteredTool } from '../tools/tools.ts';
import type { SkillDefinition } from '../skills/skills.schemas.ts';
import { getHealthDataTool, getSleepSummaryTool } from '../health/health.tools.ts';

import { ExternalServiceRegistry } from './external.ts';
import { homeassistantDefinition, haCallServiceTool } from './homeassistant/index.ts';
import { ouraDefinition } from './oura/index.ts';

/**
 * Registers all external service definitions with the registry.
 */
const registerExternalServices = (registry: ExternalServiceRegistry): void => {
  registry.register(homeassistantDefinition);
  registry.register(ouraDefinition);
};

/**
 * Registers all external service tools with the tool registry.
 * Tools are registered regardless of whether the service is configured;
 * filtering happens at query time via createServiceFilter().
 */
const registerExternalServiceTools = (toolRegistry: ToolRegistry): void => {
  toolRegistry.register(haCallServiceTool);

  // Register health tools
  toolRegistry.register(getHealthDataTool);
  toolRegistry.register(getSleepSummaryTool);
};

/**
 * Creates a filter function that checks if a tool's required services are configured.
 * Tools without requiredServices pass through (are available).
 * Tools with requiredServices are only available if all services are configured.
 */
const createServiceFilter = (serviceRegistry: ExternalServiceRegistry): ((tool: RegisteredTool) => boolean) => {
  return (tool: RegisteredTool): boolean => {
    // Tools without service dependencies are always available
    if (!tool.requiredServices || tool.requiredServices.length === 0) {
      return true;
    }

    // Check if all required services are configured
    return serviceRegistry.areServicesMet(tool.requiredServices);
  };
};

/**
 * Creates a filter function for skills based on service availability.
 * Skills without requiredServices pass through (are available).
 * Skills with requiredServices are only available if all services are configured.
 */
const createSkillServiceFilter = (serviceRegistry: ExternalServiceRegistry): ((skill: SkillDefinition) => boolean) => {
  return (skill: SkillDefinition): boolean => {
    // Skills without service dependencies are always available
    if (!skill.requiredServices || skill.requiredServices.length === 0) {
      return true;
    }

    // Check if all required services are configured
    return serviceRegistry.areServicesMet(skill.requiredServices);
  };
};

export { registerExternalServices, registerExternalServiceTools, createServiceFilter, createSkillServiceFilter };
