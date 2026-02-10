import type { Knex } from 'knex';

/**
 * Memory Consolidation tables.
 * Adds activation scoring, consolidated memories, and open loops.
 * See spec/019-memory-consolidation.md
 */
const up = async (knex: Knex): Promise<void> => {
  // Memory activation scores (extension to memories)
  await knex.schema.createTable('memory_activation', (table) => {
    table.text('memory_id').primary();
    table.float('activation_score').notNullable().defaultTo(0.5);
    table.float('decay_rate').notNullable().defaultTo(0.02);
    table.text('last_decay_at').notNullable();
    table.text('boost_history').notNullable().defaultTo('[]'); // JSON array
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_memory_activation_score ON memory_activation(activation_score DESC)');

  // Consolidated memories (distilled knowledge from multiple memories)
  await knex.schema.createTable('consolidated_memories', (table) => {
    table.text('id').primary();
    table.text('type').notNullable(); // 'entity', 'decision', 'period', 'insight', 'preference'

    // Content (JSON)
    table.text('content').notNullable(); // JSON: {summary, structuredData, keyPoints, lessons}

    // Temporal
    table.text('timespan_start').notNullable();
    table.text('timespan_end').notNullable();
    table.text('consolidated_at').notNullable();

    // Lineage
    table.text('source_memory_ids').notNullable(); // JSON array of memory IDs
    table.integer('source_memory_count').notNullable();

    // Versioning
    table.integer('version').notNullable().defaultTo(1);
    table.text('supersedes_id'); // References consolidated_memories(id)

    // Retrieval
    table.binary('embedding');
    table.float('activation_score').notNullable().defaultTo(0.5);
    table.text('last_accessed_at').notNullable();

    // Links (JSON arrays)
    table.text('entity_ids').notNullable().defaultTo('[]');
    table.text('topics').notNullable().defaultTo('[]');

    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_consolidated_type ON consolidated_memories(type)');
  await knex.schema.raw('CREATE INDEX idx_consolidated_activation ON consolidated_memories(activation_score DESC)');
  await knex.schema.raw('CREATE INDEX idx_consolidated_timespan ON consolidated_memories(timespan_end DESC)');

  // Open loops (unresolved situations to track)
  await knex.schema.createTable('open_loops', (table) => {
    table.text('id').primary();
    table.text('topic').notNullable();
    table.text('description').notNullable();

    // Activation patterns (JSON array of strings)
    table.text('activation_patterns').notNullable();

    // Links (JSON arrays)
    table.text('linked_memory_ids').notNullable().defaultTo('[]');
    table.text('linked_consolidated_ids').notNullable().defaultTo('[]');

    // Status
    table.text('status').notNullable().defaultTo('active'); // 'active', 'resolved', 'stale'
    table.integer('stale_after_days').notNullable().defaultTo(30);

    table.text('created_at').notNullable();
    table.text('last_triggered_at');
    table.text('resolved_at');
  });

  await knex.schema.raw('CREATE INDEX idx_open_loops_status ON open_loops(status)');

  // Add consolidation tracking to memories table
  await knex.schema.alterTable('memories', (table) => {
    table.text('consolidated_into_id'); // References consolidated_memories(id)
    table.text('index_status').defaultTo('hot'); // 'hot', 'warm', 'cold', 'archived'
  });

  await knex.schema.raw('CREATE INDEX idx_memories_index_status ON memories(index_status)');
  await knex.schema.raw('CREATE INDEX idx_memories_consolidated ON memories(consolidated_into_id)');

  // Consolidation job tracking
  await knex.schema.createTable('consolidation_runs', (table) => {
    table.text('id').primary();
    table.text('started_at').notNullable();
    table.text('completed_at');
    table.text('status').notNullable(); // 'running', 'completed', 'failed'

    // Stats
    table.integer('memories_processed').defaultTo(0);
    table.integer('consolidated_created').defaultTo(0);
    table.integer('consolidated_updated').defaultTo(0);
    table.text('errors'); // JSON array of errors

    table.text('created_at').notNullable();
  });
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('consolidation_runs');

  // Remove columns from memories table
  await knex.schema.alterTable('memories', (table) => {
    table.dropColumn('consolidated_into_id');
    table.dropColumn('index_status');
  });

  await knex.schema.dropTableIfExists('open_loops');
  await knex.schema.dropTableIfExists('consolidated_memories');
  await knex.schema.dropTableIfExists('memory_activation');
};

export { up, down };
