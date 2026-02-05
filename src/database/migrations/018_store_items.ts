import type { Knex } from 'knex';
import type Database from 'better-sqlite3';

/**
 * Default embedding dimensions for the local HuggingFace model (Xenova/all-MiniLM-L6-v2).
 * If you change to a different embedding provider/model, you'll need to create a new
 * migration to recreate the vec_items table with the appropriate dimensions.
 */
const DEFAULT_EMBEDDING_DIMENSIONS = 384;

/**
 * Store Items Migration
 *
 * Creates the store_items table for LangGraph BaseStore implementation.
 * This table provides a unified storage layer for:
 * - Memories (namespace: ['memories', type])
 * - Entity Knowledge (namespace: ['entities', type])
 *
 * Also creates the embedding index table and vec_items virtual table for sqlite-vec.
 * The vec_items table is created with 384 dimensions (matching the default local
 * HuggingFace model). To change dimensions, create a new migration.
 */
const up = async (knex: Knex): Promise<void> => {
  // Main store items table
  await knex.schema.createTable('store_items', (table) => {
    // Namespace is stored as JSON array string: '["memories","fact"]'
    table.text('namespace').notNullable();
    table.text('key').notNullable();

    // Value is stored as JSON object
    table.text('value').notNullable();

    // Timestamps
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();

    // Composite primary key
    table.primary(['namespace', 'key']);
  });

  // Index for namespace prefix queries
  await knex.schema.raw('CREATE INDEX idx_store_items_namespace ON store_items(namespace)');

  // Index for updated_at for ordering
  await knex.schema.raw('CREATE INDEX idx_store_items_updated_at ON store_items(updated_at DESC)');

  // Embedding index table - links vec_items rowids to store items
  await knex.schema.createTable('store_embedding_index', (table) => {
    table.increments('rowid').primary();
    table.text('namespace').notNullable();
    table.text('key').notNullable();

    // Foreign key constraint
    table.unique(['namespace', 'key']);
  });

  // Create vec_items virtual table for sqlite-vec vector search
  // Note: sqlite-vec extension must be loaded before this migration runs
  // The DatabaseService loads it via pool.afterCreate hook
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = knex.client as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const db = (await client.acquireConnection()) as Database.Database;

  db.exec(`
    CREATE VIRTUAL TABLE vec_items USING vec0(
      embedding float[${DEFAULT_EMBEDDING_DIMENSIONS}]
    )
  `);
};

const down = async (knex: Knex): Promise<void> => {
  // Drop vec_items virtual table first
  await knex.schema.raw('DROP TABLE IF EXISTS vec_items');

  await knex.schema.dropTableIfExists('store_embedding_index');
  await knex.schema.dropTableIfExists('store_items');
};

export { up, down };
