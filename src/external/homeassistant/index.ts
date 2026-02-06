// Home Assistant external service
export type { HomeAssistantClient } from './homeassistant.ts';
export { homeassistantDefinition } from './homeassistant.ts';

export type { HaCalendarEvent, HaPersonState } from './homeassistant.schemas.ts';
export { haCalendarEventSchema, normalizeHaEvent, haPersonStateSchema } from './homeassistant.schemas.ts';

export type { HaCallServiceInput, HaCallServiceOutput } from './homeassistant.tools.ts';
export { haCallServiceTool, haCallServiceInputSchema, haCallServiceOutputSchema } from './homeassistant.tools.ts';
