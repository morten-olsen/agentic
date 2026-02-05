import type { ToolRegistry } from '../tools.ts';

import { echoTool } from './echo.ts';
import { askUserTool } from './ask-user.ts';
import { webFetchTool } from './web-fetch.ts';
import { registerUserModelTools } from './user-model.ts';
import { registerContactsTools } from './contacts.ts';
import { registerCalendarTools } from './calendar.ts';
import { registerLocationTools } from './location.ts';
import { registerMemoryTools } from './memory.ts';
import { registerTaskTools } from './tasks.ts';
import { registerNotificationTools } from './notifications.ts';
import { registerDayPlannerTools } from './day-planner.ts';
import { registerTriggerTools } from './triggers.ts';
import { registerSkillTools } from './skills.ts';
import { registerArtifactTools } from './artifacts.ts';

/**
 * Registers all builtin tools with the registry.
 */
const registerBuiltinTools = (registry: ToolRegistry): void => {
  // Core tools
  registry.register(echoTool);
  registry.register(askUserTool);
  registry.register(webFetchTool);

  // Service tools
  registerUserModelTools(registry);
  registerContactsTools(registry);
  registerCalendarTools(registry);
  registerLocationTools(registry);
  registerMemoryTools(registry);
  registerTaskTools(registry);
  registerNotificationTools(registry);
  registerDayPlannerTools(registry);
  registerTriggerTools(registry);
  registerSkillTools(registry);
  registerArtifactTools(registry);
};

// Re-export individual tools for direct access
export { echoTool } from './echo.ts';
export type { EchoInput, EchoOutput } from './echo.ts';

export { askUserTool } from './ask-user.ts';
export type { AskUserInput, AskUserOutput } from './ask-user.ts';

export { webFetchTool } from './web-fetch.ts';
export type { WebFetchInput, WebFetchOutput, WebFetchRawOutput, WebFetchArticleOutput } from './web-fetch.ts';

// Re-export service tool registrations
export { registerUserModelTools } from './user-model.ts';
export { registerContactsTools } from './contacts.ts';
export { registerCalendarTools } from './calendar.ts';
export { registerLocationTools } from './location.ts';
export { registerMemoryTools } from './memory.ts';
export { registerTaskTools } from './tasks.ts';
export { registerNotificationTools } from './notifications.ts';
export { registerDayPlannerTools } from './day-planner.ts';
export { registerTriggerTools } from './triggers.ts';
export { registerSkillTools } from './skills.ts';
export { registerArtifactTools } from './artifacts.ts';
export type { GetArtifactInput, GetArtifactOutput, ListArtifactsInput, ListArtifactsOutput } from './artifacts.ts';

export { registerBuiltinTools };
