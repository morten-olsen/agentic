import type { Knex } from 'knex';

/**
 * Phase 4 Memory enhancement: Entity Knowledge tables.
 * Creates tables for storing knowledge about things in the user's world
 * (companies, products, documents, concepts, etc.) and their relationships.
 */
const up = async (knex: Knex): Promise<void> => {
  // Entity Knowledge - things in user's world
  await knex.schema.createTable('entity_knowledge', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('type').notNullable(); // 'company' | 'project' | 'document' | 'product' | 'concept' | 'place' | 'other'
    table.text('description');
    table.text('attributes'); // JSON (flexible key-value pairs)
    table.text('source').notNullable().defaultTo('explicit'); // 'explicit' | 'inferred'
    table.float('confidence').notNullable().defaultTo(1.0);
    table.text('last_referenced_at').notNullable();
    table.integer('reference_count').notNullable().defaultTo(0);
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_entity_knowledge_type ON entity_knowledge(type)');
  await knex.schema.raw('CREATE INDEX idx_entity_knowledge_name ON entity_knowledge(name)');

  // Entity relationships - links between entities and other objects
  await knex.schema.createTable('entity_relations', (table) => {
    table.text('id').primary();
    table.text('source_entity_id').notNullable().references('id').inTable('entity_knowledge').onDelete('CASCADE');
    table.text('target_entity_id').notNullable();
    table.text('target_type').notNullable(); // 'entity' | 'contact' | 'project'
    table.text('relationship_type').notNullable(); // 'has_contact', 'belongs_to', 'uses_template', etc.
    table.text('metadata'); // JSON
    table.text('created_at').notNullable();
  });

  await knex.schema.raw('CREATE INDEX idx_entity_relations_source ON entity_relations(source_entity_id)');
  await knex.schema.raw('CREATE INDEX idx_entity_relations_target ON entity_relations(target_entity_id)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('entity_relations');
  await knex.schema.dropTableIfExists('entity_knowledge');
};

export { up, down };
