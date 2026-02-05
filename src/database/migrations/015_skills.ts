import type { Knex } from 'knex';

/**
 * Skills System Migration
 * Creates table for tracking skill activations (analytics and debugging).
 * Also adds skill_activation column to interrupts table.
 */
const up = async (knex: Knex): Promise<void> => {
  // Track skill activations for analytics and debugging
  await knex.schema.createTable('skill_activations', (table) => {
    table.text('id').primary();
    table.text('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    table.text('skill_id').notNullable();
    table.text('activated_at').notNullable();
    table.text('deactivated_at');
    table.text('activation_params'); // JSON
    table.text('activation_risk').notNullable();
    table.integer('required_approval').notNullable(); // 0 or 1 (SQLite boolean)
    table.text('approved_at');
    table.text('created_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_skill_activations_conversation ON skill_activations(conversation_id)');
  await knex.schema.raw('CREATE INDEX idx_skill_activations_skill ON skill_activations(skill_id)');

  // Add skill_activation column to interrupts table for skill_activation interrupt type
  await knex.schema.alterTable('interrupts', (table) => {
    table.text('skill_activation'); // JSON: { skillId, skillName, activationRisk, activationReason, activationParams, toolsSummary }
  });
};

const down = async (knex: Knex): Promise<void> => {
  // Remove skill_activation column from interrupts
  await knex.schema.alterTable('interrupts', (table) => {
    table.dropColumn('skill_activation');
  });

  await knex.schema.dropTableIfExists('skill_activations');
};

export { up, down };
