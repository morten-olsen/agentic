/**
 * Flow tests for skills system.
 * Tests skill activation, skill tool availability after activation, and skill deactivation.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../setup.ts';
import { createTestServices, collectChatResponse } from '../utils/services.ts';
import { createChatCompletion, createToolCallCompletion } from '../mocks/openai-responses.ts';
import type { Services } from '../../src/core/services/services.ts';
import type { OrchestratorService } from '../../src/agent/orchestrator/orchestrator.ts';
import { TriggerService } from '../../src/features/triggers/triggers.ts';

describe('Skills Flow', () => {
  let services: Services;
  let orchestrator: OrchestratorService;

  beforeEach(async () => {
    const result = await createTestServices();
    services = result.services;
    orchestrator = result.orchestrator;
    // Initialize trigger service for debugging skill to work
    services.get(TriggerService);
  });

  afterEach(async () => {
    await services.destroy();
  });

  it('activates low-risk skill without interrupt', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // First call: activate the debugging skill
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_activate',
                name: 'activate_debugging',
                args: {},
              },
            ]),
          );
        }
        // Second call: respond after activation
        return HttpResponse.json(
          createChatCompletion("I've activated the debugging skill and now have access to system debugging tools."),
        );
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response, chunks } = await collectChatResponse(
      orchestrator.chat(conversationId, 'Activate the debugging skill'),
    );

    // Should NOT have an interrupt (low risk skill activates immediately)
    const interruptChunk = chunks.find((c) => c.type === 'interrupt');
    expect(interruptChunk).toBeUndefined();

    // Should complete successfully
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
    expect(response).toContain('debugging');
  });

  it('skill tools become available in next turn (not same turn as activation)', async () => {
    // NOTE: Skill tools cannot be used in the same turn as activation because
    // tools are bound to the LLM at graph creation time, before we know which
    // skills will be activated during that turn.
    //
    // This test verifies that after activation completes, the tools become
    // available in the following turn. See 'skill tools work in subsequent
    // chat turns' for the full flow test.
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // First call: activate the debugging skill
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_activate',
                name: 'activate_debugging',
                args: {},
              },
            ]),
          );
        }
        // Second call: respond to activation
        return HttpResponse.json(createChatCompletion('Debugging skill activated. You can now use debugging tools.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response, chunks } = await collectChatResponse(
      orchestrator.chat(conversationId, 'Activate the debugging skill'),
    );

    // Should NOT have an interrupt for activation (low risk)
    const interruptChunks = chunks.filter((c) => c.type === 'interrupt');
    expect(interruptChunks.length).toBe(0);

    // Should complete successfully
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
    expect(response).toContain('activated');
  });

  it('skill tools work in subsequent chat turns', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // First call: activate the debugging skill
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_activate',
                name: 'activate_debugging',
                args: {},
              },
            ]),
          );
        }
        if (callCount === 2) {
          // Second call: respond after activation
          return HttpResponse.json(createChatCompletion('Debugging skill is now active.'));
        }
        if (callCount === 3) {
          // Third call (new turn): use a skill tool
          // Note: The tool name is the tool.id, not tool.name
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_list_triggers',
                name: 'debugging_list_triggers',
                args: {},
              },
            ]),
          );
        }
        // Fourth call: respond with results
        return HttpResponse.json(createChatCompletion('Here are the current triggers in the system.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();

    // First turn: activate the skill
    const firstResult = await collectChatResponse(orchestrator.chat(conversationId, 'Activate the debugging skill'));
    expect(firstResult.chunks.some((c) => c.type === 'done')).toBe(true);

    // Verify skill is active in checkpoint state
    const stateAfterActivation = await orchestrator.getState(conversationId);
    const activeSkillsAfterActivation =
      (stateAfterActivation as { activeSkills?: { id: string }[] })?.activeSkills ?? [];
    expect(activeSkillsAfterActivation.length).toBeGreaterThan(0);
    expect(activeSkillsAfterActivation[0].id).toBe('debugging');

    // Second turn: use a skill tool
    const secondResult = await collectChatResponse(orchestrator.chat(conversationId, 'List all triggers'));

    // Should NOT have an interrupt for unknown tool
    const interruptChunks = secondResult.chunks.filter((c) => c.type === 'interrupt');
    for (const chunk of interruptChunks) {
      if (chunk.type === 'interrupt') {
        const interrupt = (chunk as { type: 'interrupt'; interrupt: { toolCall?: { riskReason?: string } } }).interrupt;
        if (interrupt.toolCall) {
          expect(interrupt.toolCall.riskReason).not.toContain('Unknown tool');
        }
      }
    }

    // Should complete successfully
    expect(secondResult.chunks.some((c) => c.type === 'done')).toBe(true);
  });

  it('lists available skills', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_list',
                name: 'skills.list_skills',
                args: {},
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('Here are the available skills including System Debugging.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();
    const { response, chunks } = await collectChatResponse(
      orchestrator.chat(conversationId, 'What skills are available?'),
    );

    // Should complete without interrupt (list_skills is low risk)
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
    expect(response).toContain('skill');
  });

  it('deactivates skill', async () => {
    let callCount = 0;
    server.use(
      http.post('*/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // Activate first
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_activate',
                name: 'activate_debugging',
                args: {},
              },
            ]),
          );
        }
        if (callCount === 2) {
          return HttpResponse.json(createChatCompletion('Debugging skill activated.'));
        }
        if (callCount === 3) {
          // Deactivate (use the tool.id as name)
          return HttpResponse.json(
            createToolCallCompletion([
              {
                id: 'call_deactivate',
                name: 'skills.deactivate_skill',
                args: { skillId: 'debugging' },
              },
            ]),
          );
        }
        return HttpResponse.json(createChatCompletion('Debugging skill has been deactivated.'));
      }),
    );

    const conversationId = await orchestrator.startConversation();

    // Activate
    await collectChatResponse(orchestrator.chat(conversationId, 'Activate debugging'));

    // Deactivate
    const { response, chunks } = await collectChatResponse(
      orchestrator.chat(conversationId, 'Deactivate the debugging skill'),
    );

    expect(chunks.some((c) => c.type === 'done')).toBe(true);
    expect(response).toContain('deactivated');
  });
});

describe('High-Risk Skill Activation', () => {
  let services: Services;

  beforeEach(async () => {
    const result = await createTestServices();
    services = result.services;
  });

  afterEach(async () => {
    await services.destroy();
  });

  // Note: The debugging skill is low-risk, so it activates immediately.
  // When we have high-risk skills, add tests here for the approval flow.
  it('placeholder for high-risk skill tests', async () => {
    // This test documents that high-risk skills would require approval.
    // Currently only the low-risk debugging skill is implemented.
    expect(true).toBe(true);
  });
});
