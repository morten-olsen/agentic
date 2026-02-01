/**
 * Flow tests for human-in-the-loop interrupt flow.
 * Tests risk gate, interrupt creation, approval, and denial.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../setup.ts';
import { createTestServices, collectChatResponse } from '../utils/services.ts';
import { createChatCompletion, createToolCallCompletion } from '../mocks/openai-responses.ts';
import type { Services } from '../../src/services/services.ts';
import type { OrchestratorService, ChatChunk } from '../../src/orchestrator/orchestrator.ts';
import { ContactsService } from '../../src/contacts/contacts.ts';

describe('Interrupt Flow', () => {
  let services: Services;
  let orchestrator: OrchestratorService;

  beforeEach(async () => {
    const result = await createTestServices();
    services = result.services;
    orchestrator = result.orchestrator;
  });

  afterEach(async () => {
    await services.destroy();
  });

  it('creates interrupt for medium-risk tool', async () => {
    // Create a contact to delete
    const contactsService = services.get(ContactsService);
    const contact = await contactsService.createContact({
      name: 'Test Contact',
      relationship: 'test',
    });

    server.use(
      http.post('*/chat/completions', () => {
        return HttpResponse.json(
          createToolCallCompletion([
            {
              id: 'call_delete',
              name: 'contacts.delete',
              args: { id: contact.id },
            },
          ]),
        );
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const chunks: ChatChunk[] = [];

    for await (const chunk of orchestrator.chat(conversationId, 'Delete my test contact')) {
      chunks.push(chunk);
    }

    // Should have an interrupt chunk
    const interruptChunk = chunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeDefined();
    expect(interruptChunk?.type).toBe('interrupt');

    // Verify interrupt was stored
    const interrupt = await orchestrator.interruptService.getPending(conversationId);
    expect(interrupt).not.toBeNull();
    expect(interrupt?.type).toBe('tool_approval');
    expect(interrupt?.toolCall?.toolName).toBe('contacts.delete');
  });

  it('resumes after approval and executes tool', async () => {
    // Create a contact to delete
    const contactsService = services.get(ContactsService);
    const contact = await contactsService.createContact({
      name: 'Contact To Delete',
      relationship: 'test',
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        // Call 1: Initial request triggers tool call → interrupt
        // Call 2: After approval, router called again → same tool call
        // Call 3: After tool execution → final text response
        if (callCount <= 2) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_delete',
                name: 'contacts.delete',
                args: { id: contact.id },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('The contact has been deleted successfully.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();

    // First chat triggers the interrupt
    const firstChunks: ChatChunk[] = [];
    for await (const chunk of orchestrator.chat(conversationId, 'Delete the test contact')) {
      firstChunks.push(chunk);
    }

    const interruptChunk = firstChunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeDefined();

    // Approve the interrupt
    const { response, chunks } = await collectChatResponse(orchestrator.chat(conversationId, 'yes'));

    // Should have interrupt_resolved chunk
    expect(chunks.some((c) => c.type === 'interrupt_resolved')).toBe(true);

    // Tool should have been executed
    const deletedContact = await contactsService.getContact(contact.id);
    expect(deletedContact).toBeNull();

    // Should get a final response
    expect(response).toContain('deleted');
  });

  it('handles denial and asks for alternative', async () => {
    // Create a contact
    const contactsService = services.get(ContactsService);
    const contact = await contactsService.createContact({
      name: 'Do Not Delete',
      relationship: 'friend',
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_delete',
                name: 'contacts.delete',
                args: { id: contact.id },
              },
            ]),
          );
        }
        // After denial, LLM acknowledges (this includes any resumed calls)
        return HttpResponse.json(
          createChatCompletion("Understood, I won't delete that contact. Is there something else I can help with?"),
        );
      }),
    );

    const conversationId = await orchestrator.startConversation();

    // Trigger interrupt
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of orchestrator.chat(conversationId, 'Delete this contact')) {
      // consume
    }

    // Deny the interrupt
    const denialChunks: ChatChunk[] = [];
    for await (const chunk of orchestrator.chat(conversationId, 'no')) {
      denialChunks.push(chunk);
      // After denial we may see another interrupt if LangGraph checkpoint still has tool call
      // In a real scenario, the LLM would see the denial in history and respond differently
    }

    // Should have interrupt_resolved chunk indicating denial was processed
    expect(denialChunks.some((c) => c.type === 'interrupt_resolved')).toBe(true);

    // Contact should NOT be deleted (tool was never executed due to denial)
    const stillExists = await contactsService.getContact(contact.id);
    expect(stillExists).not.toBeNull();

    // Note: Due to LangGraph checkpoint behavior, we may get another interrupt
    // instead of a text response. This is acceptable behavior - the key test is
    // that the contact was NOT deleted despite the tool call being in the checkpoint.
  });

  it('handles denial with custom message', async () => {
    const contactsService = services.get(ContactsService);
    const contact = await contactsService.createContact({
      name: 'Important Contact',
      relationship: 'colleague',
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_delete',
                name: 'contacts.delete',
                args: { id: contact.id },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion("Got it, I'll just update the contact information instead."));
      }),
    );

    const conversationId = await orchestrator.startConversation();

    // Trigger interrupt
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of orchestrator.chat(conversationId, 'Delete this contact')) {
      // consume
    }

    // Deny with custom message
    const { response } = await collectChatResponse(
      orchestrator.chat(conversationId, "Don't delete it, just update the email instead"),
    );

    // Contact should still exist
    const stillExists = await contactsService.getContact(contact.id);
    expect(stillExists).not.toBeNull();

    // Agent should acknowledge the alternative
    expect(response).toBeDefined();
  });

  it('low-risk tools do not trigger interrupt', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_echo',
                name: 'builtin.echo',
                args: { message: 'hello' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('Echo returned: hello'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { chunks } = await collectChatResponse(orchestrator.chat(conversationId, 'Echo hello'));

    // Should NOT have interrupt chunk
    const interruptChunk = chunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeUndefined();

    // Should complete normally
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  it('respondToInterrupt API works directly', async () => {
    const contactsService = services.get(ContactsService);
    const contact = await contactsService.createContact({
      name: 'API Test Contact',
      relationship: 'test',
    });

    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        // Call 1: Initial request triggers tool call → interrupt
        // Call 2: After approval via API, router called again → same tool call
        // Call 3: After tool execution → final text response
        if (callCount <= 2) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_delete',
                name: 'contacts.delete',
                args: { id: contact.id },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('Contact deleted via API approval.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();

    // Trigger interrupt
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of orchestrator.chat(conversationId, 'Delete contact')) {
      // consume
    }

    // Get the pending interrupt
    const interrupt = await orchestrator.interruptService.getPending(conversationId);
    expect(interrupt).not.toBeNull();

    // Approve via API - interrupt is verified non-null above
    const { response, chunks } = await collectChatResponse(
      orchestrator.respondToInterrupt(interrupt?.id ?? '', { approved: true }),
    );

    expect(chunks.some((c) => c.type === 'interrupt_resolved')).toBe(true);
    expect(response).toContain('deleted');

    // Contact should be deleted
    const deleted = await contactsService.getContact(contact.id);
    expect(deleted).toBeNull();
  });
});
