import type { Knex } from 'knex';

const up = async (knex: Knex): Promise<void> => {
  // Create domain whitelist table for trusted domains
  await knex.schema.createTable('domain_whitelist', (table) => {
    table.text('domain').primary(); // Normalized domain (lowercase)
    table.text('added_at').notNullable(); // ISO8601 timestamp
    table.text('added_by_conversation_id'); // Conversation that added it
    table.text('reason'); // Optional reason for whitelisting
  });

  // Index for listing by recency
  await knex.schema.raw('CREATE INDEX idx_domain_whitelist_added_at ON domain_whitelist(added_at DESC)');
};

const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('domain_whitelist');
};

export { up, down };
