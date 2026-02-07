import type { Knex } from 'knex';

/**
 * Phase 3 Human in the Loop tables.
 * Creates the interrupts table for approval flows.
 */
const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('interrupts', (table) => {
    table.text('id').primary();
    table.text('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    table.text('type').notNullable(); // 'tool_approval' | 'question' | 'confirmation' | 'error_recovery'
    table.text('prompt').notNullable();
    table.text('context'); // Additional context for the user
    table.text('options'); // JSON array of InterruptOption
    table.integer('allow_freeform').notNullable().defaultTo(1);

    // For tool_approval type
    table.text('tool_call'); // JSON: { toolId, toolName, input, riskLevel, riskReason }

    // State management
    table.text('status').notNullable().defaultTo('pending'); // 'pending' | 'approved' | 'denied' | 'expired'
    table.text('checkpoint_id'); // LangGraph checkpoint to resume from

    // Timing
    table.text('created_at').notNullable();
    table.text('expires_at'); // Optional deadline
    table.text('responded_at');
    table.text('response'); // JSON: { approved?, selectedOptionId?, freeformResponse? }
  });

  await knex.schema.raw('CREATE INDEX idx_interrupts_conversation ON interrupts(conversation_id)');
  await knex.schema.raw('CREATE INDEX idx_interrupts_status ON interrupts(status)');
  await knex.schema.raw(`CREATE INDEX idx_interrupts_pending ON interrupts(status) WHERE status = 'pending'`);
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('interrupts');
};

export { up, down };
