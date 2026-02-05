import type { AgentContext } from '../context/context.ts';
import type { TriggerContext } from '../triggers/triggers.schemas.ts';
import type { ActiveSkill } from '../skills/skills.schemas.ts';
import type { SkillRegistry } from '../skills/skills.ts';
import { generateActiveSkillsContext } from '../skills/skills.context.ts';

import type { PersonalityConfig, Style, Traits } from './personality.schemas.ts';

/**
 * System-level tool usage instructions.
 * These are always included in the prompt regardless of database configuration.
 */
const SYSTEM_TOOL_INSTRUCTIONS = `## Tool Usage

You have access to various tools to help the user. Always use the appropriate tools to complete tasks rather than claiming to have done something without actually doing it.

Key capabilities:
- **Reminders & Scheduling**: Use \`create_trigger\` to set reminders or schedule future tasks. Use \`list_triggers\` to show existing triggers. Use \`update_trigger\` or \`delete_trigger\` to modify them.
- **Calendar**: Use calendar tools to check schedules, create events, and manage appointments.
- **Tasks**: Use task tools to create, update, and track tasks.
- **Memory**: Use memory tools to store and recall important information.
- **Contacts**: Use contact tools to manage people and relationships.
- **Location**: Use location tools for place-related queries.
- **Day Planning**: Use day planner tools to help organize the user's day.

**Important**: When a user asks you to remind them of something, set an alarm, or schedule a task for later, you MUST use the \`create_trigger\` tool. Never claim to have set a reminder without actually calling the tool.`;

/**
 * Generates the style instructions based on style settings.
 */
const generateStyleInstructions = (style: Style): string => {
  const instructions: string[] = [];

  // Formality
  switch (style.formality) {
    case 'casual':
      instructions.push('Use a relaxed, friendly tone. Contractions are fine.');
      break;
    case 'professional':
      instructions.push('Maintain a professional but approachable tone.');
      break;
    case 'formal':
      instructions.push('Use formal language and complete sentences.');
      break;
  }

  // Verbosity
  switch (style.verbosity) {
    case 'terse':
      instructions.push('Be concise. Avoid unnecessary elaboration.');
      break;
    case 'balanced':
      instructions.push('Provide clear explanations without being verbose.');
      break;
    case 'detailed':
      instructions.push('Provide thorough explanations and context.');
      break;
  }

  // Humor
  switch (style.humor) {
    case 'none':
      instructions.push('Keep responses serious and straightforward.');
      break;
    case 'subtle':
      instructions.push('Light humor is acceptable when appropriate.');
      break;
    case 'witty':
      instructions.push('Feel free to be witty and playful when the context allows.');
      break;
  }

  // Emoji
  switch (style.emoji) {
    case 'never':
      instructions.push('Do not use emojis.');
      break;
    case 'minimal':
      instructions.push('Use emojis sparingly, only for emphasis.');
      break;
    case 'moderate':
      instructions.push('Emojis can be used to enhance communication.');
      break;
  }

  return instructions.join(' ');
};

/**
 * Generates trait instructions based on trait settings.
 */
const generateTraitInstructions = (traits: Traits): string => {
  const instructions: string[] = [];

  // Proactivity
  switch (traits.proactivity) {
    case 'reactive':
      instructions.push('Only respond to explicit requests. Do not volunteer suggestions.');
      break;
    case 'suggestive':
      instructions.push('Offer suggestions when they seem helpful.');
      break;
    case 'proactive':
      instructions.push('Actively anticipate needs and proactively offer help.');
      break;
  }

  // Confidence
  switch (traits.confidence) {
    case 'humble':
      instructions.push('Acknowledge uncertainty when applicable.');
      break;
    case 'balanced':
      instructions.push('Be confident but acknowledge limitations when relevant.');
      break;
    case 'confident':
      instructions.push('Be confident and decisive in responses.');
      break;
  }

  // Directness
  switch (traits.directness) {
    case 'diplomatic':
      instructions.push('Frame responses diplomatically, especially for sensitive topics.');
      break;
    case 'balanced':
      instructions.push('Be direct while remaining tactful.');
      break;
    case 'direct':
      instructions.push('Be straightforward and to the point.');
      break;
  }

  return instructions.join(' ');
};

/**
 * Generates context-aware instructions based on AgentContext.
 */
const generateContextInstructions = (context: AgentContext): string => {
  const instructions: string[] = [];

  // User greeting
  if (context.user?.name) {
    instructions.push(`The user's name is ${context.user.name}.`);
  }

  // Time awareness
  instructions.push(`User's timezone: ${context.timezone}`);
  instructions.push(`Local time: ${context.localTime}`);
  instructions.push(`Time of day: ${context.timeOfDay}`);
  instructions.push('Always display times to the user in their local timezone, not UTC.');

  if (!context.isWorkingHours) {
    instructions.push('Note: Outside of working hours.');
  }

  // Location awareness
  if (context.location?.coordinates) {
    // GPS coordinates from Home Assistant
    const { latitude, longitude, accuracy } = context.location.coordinates;
    instructions.push(`User location (GPS): ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (accuracy: ${accuracy}m)`);

    // Location status
    const status = context.location.atHome ? 'at home' : context.location.atWork ? 'at work' : 'away';
    instructions.push(`Location status: ${status}`);

    // Staleness warning if location data is old
    if (context.location.lastLocationChange) {
      const lastChange = new Date(context.location.lastLocationChange);
      const ageMinutes = Math.floor((Date.now() - lastChange.getTime()) / 60000);
      if (ageMinutes > 60) {
        instructions.push(`Warning: Location data is ${Math.floor(ageMinutes / 60)} hours old`);
      }
    }
  } else if (context.location?.current) {
    // Fallback to schedule-inferred location
    instructions.push(`User is at: ${context.location.current.name} (${context.location.current.type})`);
  } else if (context.location) {
    // No GPS and no inferred location, but we have status
    const status = context.location.atHome ? 'at home' : context.location.atWork ? 'at work' : 'location unknown';
    instructions.push(`Location status: ${status}`);
  }

  // Calendar awareness
  if (context.calendar?.currentEvent) {
    instructions.push(`Current event: ${context.calendar.currentEvent.title}`);
  }

  if (context.calendar?.nextEvent) {
    const minutesToNext = context.calendar.minutesToNext ?? 0;
    if (minutesToNext <= 30) {
      instructions.push(`Upcoming event in ${minutesToNext} minutes: ${context.calendar.nextEvent.title}`);
    }
  }

  // Active projects
  if (context.user?.activeProjects && context.user.activeProjects.length > 0) {
    const projectNames = context.user.activeProjects.map((p) => p.name).join(', ');
    instructions.push(`Active projects: ${projectNames}`);
  }

  return instructions.join('\n');
};

/**
 * Generates topic-specific guidelines.
 */
const generateTopicGuidelines = (topicGuidelines: Record<string, string>): string => {
  if (Object.keys(topicGuidelines).length === 0) return '';

  const guidelines = Object.entries(topicGuidelines)
    .map(([topic, guideline]) => `- ${topic}: ${guideline}`)
    .join('\n');

  return `Topic-specific guidelines:\n${guidelines}`;
};

/**
 * Generates example interactions section.
 */
const generateExamplesSection = (examples: PersonalityConfig['examples']): string => {
  if (examples.length === 0) return '';

  const exampleText = examples
    .map((ex, i) => {
      let text = `Example ${i + 1}:\nUser: ${ex.userInput}\nAssistant: ${ex.idealResponse}`;
      if (ex.explanation) {
        text += `\n(${ex.explanation})`;
      }
      return text;
    })
    .join('\n\n');

  return `Reference examples for tone and style:\n${exampleText}`;
};

/**
 * Generates trigger-specific instructions when running from a trigger invocation.
 */
const generateTriggerInstructions = (triggerContext: TriggerContext): string => {
  const lines: string[] = [
    '## Trigger Mode',
    '',
    'You are running from a scheduled trigger. The user will not see this conversation directly.',
    '',
    `**Your goal:** ${triggerContext.goal}`,
  ];

  if (triggerContext.setupContext) {
    lines.push(`**Context:** ${triggerContext.setupContext}`);
  }

  lines.push(`**Trigger name:** ${triggerContext.triggerName}`);
  lines.push(`**Invocation #:** ${triggerContext.invocationCount}`);

  if (triggerContext.schedule.type === 'cron') {
    lines.push(`**Schedule:** ${triggerContext.schedule.expression} (recurring)`);
  } else {
    lines.push(`**Schedule:** One-time trigger`);
  }

  lines.push('');
  lines.push('**Instructions:**');
  lines.push('- If you discover something the user should know, use the `notify` tool to send them a message.');
  lines.push(
    '- If this trigger is no longer needed, use `delete_trigger` (no ID needed - it will delete this trigger).',
  );
  lines.push('- If the trigger parameters need adjustment, use `update_trigger` (no ID needed).');
  lines.push('- You have access to all normal tools plus trigger management and notify tools.');
  lines.push('- Only notify if you have something meaningful to share. Do not notify just to confirm the trigger ran.');

  return lines.join('\n');
};

/**
 * Options for building the system prompt.
 */
type BuildSystemPromptOptions = {
  context?: AgentContext;
  triggerContext?: TriggerContext;
  activeSkills?: ActiveSkill[];
  skillRegistry?: SkillRegistry;
};

/**
 * Builds the complete system prompt from personality config and context.
 */
const buildSystemPrompt = (
  config: PersonalityConfig,
  contextOrOptions?: AgentContext | BuildSystemPromptOptions,
  triggerContext?: TriggerContext,
): string => {
  // Support both old signature (config, context?, triggerContext?) and new options object
  let options: BuildSystemPromptOptions;
  if (contextOrOptions && 'timezone' in contextOrOptions) {
    // Old signature: AgentContext passed directly
    options = { context: contextOrOptions, triggerContext };
  } else if (contextOrOptions) {
    // New signature: options object
    options = contextOrOptions;
  } else {
    options = { triggerContext };
  }

  const sections: string[] = [];

  // Identity
  sections.push(`You are ${config.name}, a ${config.role}.`);

  // System-level tool instructions (always included)
  sections.push(SYSTEM_TOOL_INSTRUCTIONS);

  // User-customizable core instructions
  if (config.coreInstructions) {
    sections.push(config.coreInstructions);
  }

  // Style instructions
  const styleInstructions = generateStyleInstructions(config.style);
  if (styleInstructions) {
    sections.push(`Communication style: ${styleInstructions}`);
  }

  // Trait instructions
  const traitInstructions = generateTraitInstructions(config.traits);
  if (traitInstructions) {
    sections.push(`Behavioral traits: ${traitInstructions}`);
  }

  // Topic guidelines
  const topicGuidelines = generateTopicGuidelines(config.topicGuidelines);
  if (topicGuidelines) {
    sections.push(topicGuidelines);
  }

  // Examples
  const examples = generateExamplesSection(config.examples);
  if (examples) {
    sections.push(examples);
  }

  // Context-aware instructions
  if (options.context) {
    const contextInstructions = generateContextInstructions(options.context);
    if (contextInstructions) {
      sections.push(`Current context:\n${contextInstructions}`);
    }
  }

  // Active skills context
  if (options.activeSkills && options.skillRegistry && options.activeSkills.length > 0) {
    const skillsContext = generateActiveSkillsContext(options.activeSkills, options.skillRegistry);
    if (skillsContext) {
      sections.push(skillsContext);
    }
  }

  // Trigger-specific instructions
  if (options.triggerContext) {
    sections.push(generateTriggerInstructions(options.triggerContext));
  }

  return sections.join('\n\n');
};

export type { BuildSystemPromptOptions };
export {
  buildSystemPrompt,
  generateStyleInstructions,
  generateTraitInstructions,
  generateContextInstructions,
  generateTopicGuidelines,
  generateExamplesSection,
  generateTriggerInstructions,
  SYSTEM_TOOL_INSTRUCTIONS,
};
