import type { Knex } from 'knex';

/**
 * Behavioral Memory tables.
 * Templates, outcomes, and pending outcomes for the behavioral learning loop.
 * See spec/020-behavioral-memory.md
 */
const up = async (knex: Knex): Promise<void> => {
  // Behavioral templates
  await knex.schema.createTable('behavioral_templates', (table) => {
    table.text('id').primary();

    // Situation
    table.text('situation_description').notNullable();
    table.text('situation_category').notNullable();
    table.text('trigger_patterns').notNullable().defaultTo('[]'); // JSON array

    // Strategy
    table.text('strategy').notNullable(); // JSON

    // Evidence
    table.integer('total_interactions').notNullable().defaultTo(0);
    table.integer('positive_outcomes').notNullable().defaultTo(0);
    table.integer('negative_outcomes').notNullable().defaultTo(0);
    table.integer('neutral_outcomes').notNullable().defaultTo(0);
    table.text('last_outcomes').notNullable().defaultTo('[]'); // JSON array
    table.float('confidence_score').notNullable().defaultTo(0.3);

    // Retrieval
    table.binary('embedding');
    table.float('activation_score').notNullable().defaultTo(0.5);

    // Lifecycle
    table.text('status').notNullable().defaultTo('active');
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
    table.text('last_matched_at');
  });

  await knex.schema.raw('CREATE INDEX idx_bt_category ON behavioral_templates(situation_category)');
  await knex.schema.raw('CREATE INDEX idx_bt_status ON behavioral_templates(status)');
  await knex.schema.raw('CREATE INDEX idx_bt_activation ON behavioral_templates(activation_score DESC)');
  await knex.schema.raw('CREATE INDEX idx_bt_confidence ON behavioral_templates(confidence_score DESC)');

  // Outcome records
  await knex.schema.createTable('behavioral_outcomes', (table) => {
    table.text('id').primary();
    table.text('template_id').notNullable().references('id').inTable('behavioral_templates');

    table.text('action').notNullable();
    table.text('signal').notNullable();
    table.text('detail').notNullable();
    table.text('strategy_change');
    table.text('context').notNullable().defaultTo('{}'); // JSON

    table.text('created_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_bo_template ON behavioral_outcomes(template_id)');
  await knex.schema.raw('CREATE INDEX idx_bo_signal ON behavioral_outcomes(signal)');
  await knex.schema.raw('CREATE INDEX idx_bo_created ON behavioral_outcomes(created_at DESC)');

  // Pending outcomes
  await knex.schema.createTable('behavioral_pending_outcomes', (table) => {
    table.text('id').primary();
    table.text('template_id').notNullable().references('id').inTable('behavioral_templates');

    table.text('action').notNullable();
    table.text('summary').notNullable();
    table.text('source_conversation_id').notNullable();
    table.text('trigger_id');

    table.text('status').notNullable().defaultTo('pending');
    table.text('created_at').notNullable();
    table.text('expires_at').notNullable();
    table.text('resolved_at');
    table.text('resolved_outcome_id').references('id').inTable('behavioral_outcomes');
  });

  await knex.schema.raw('CREATE INDEX idx_bpo_status ON behavioral_pending_outcomes(status)');
  await knex.schema.raw('CREATE INDEX idx_bpo_expires ON behavioral_pending_outcomes(expires_at)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('behavioral_pending_outcomes');
  await knex.schema.dropTableIfExists('behavioral_outcomes');
  await knex.schema.dropTableIfExists('behavioral_templates');
};

export { up, down };
