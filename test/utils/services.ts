/**
 * Test service setup utilities.
 * Creates a fully-initialized Services container for flow tests.
 */

import { Services } from '../../src/services/services.ts';
import { DatabaseService, createDatabaseService } from '../../src/database/database.ts';
import { UserModelService } from '../../src/user-model/user-model.ts';
import { LocationService } from '../../src/location/location.ts';
import { CalendarService } from '../../src/calendar/calendar.ts';
import { ContactsService } from '../../src/contacts/contacts.ts';
import { ContextBuilderService } from '../../src/context/context.ts';
import { PersonalityService } from '../../src/personality/personality.ts';
import { MemoryService } from '../../src/memory/memory.ts';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.ts';

type TestServicesResult = {
  services: Services;
  orchestrator: OrchestratorService;
};

/**
 * Creates a fully-initialized services container for testing.
 * Uses in-memory SQLite database.
 */
const createTestServices = async (): Promise<TestServicesResult> => {
  const services = new Services();

  // Initialize database with in-memory SQLite
  const db = createDatabaseService(services, { path: ':memory:' });
  services.set(DatabaseService, db);
  await db.migrate();

  // Initialize all required services (order matters due to dependencies)
  services.get(UserModelService);
  services.get(LocationService);
  services.get(ContactsService);
  services.get(CalendarService);
  services.get(ContextBuilderService);
  services.get(PersonalityService);
  services.get(MemoryService);

  // Create and configure orchestrator
  const orchestrator = new OrchestratorService(services);
  orchestrator.configure({
    llm: {
      apiKey: 'test-api-key',
      baseUrl: 'https://api.test.com/v1',
    },
  });

  return { services, orchestrator };
};

type ChunkType = { type: string; content?: string; error?: string };

/**
 * Collects all chunks from a chat response generator.
 */
const collectChatResponse = async (
  generator: AsyncGenerator<ChunkType>,
): Promise<{ response: string; chunks: ChunkType[] }> => {
  const chunks: ChunkType[] = [];
  let response = '';

  for await (const chunk of generator) {
    chunks.push(chunk);
    if (chunk.type === 'token' && chunk.content) {
      response += chunk.content;
    }
  }

  return { response, chunks };
};

export type { TestServicesResult };
export { createTestServices, collectChatResponse };
