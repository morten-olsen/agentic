import type { Knex } from 'knex';

/**
 * Migrates feedback memories from store_items into behavioral_templates.
 *
 * Feedback memories captured user corrections (e.g., "User prefers shorter responses")
 * but were never systematically acted upon. Behavioral templates close this loop by
 * making the agent's behavior adapt based on these corrections.
 *
 * This is a forward-only data migration — the down function is a no-op.
 */

type FeedbackRow = {
  namespace: string;
  key: string;
  value: string;
  created_at: string;
};

const embeddingToBuffer = (arr: number[]): Buffer => {
  return Buffer.from(new Float32Array(arr).buffer);
};

const up = async (knex: Knex): Promise<void> => {
  // Query all feedback memories from store_items
  const feedbackRows = await knex<FeedbackRow>('store_items').where('namespace', '["memories","feedback"]').select('*');

  if (feedbackRows.length === 0) {
    return;
  }

  const now = new Date().toISOString();

  for (const row of feedbackRows) {
    const parsed = JSON.parse(row.value) as {
      content?: string;
      metadata?: Record<string, unknown>;
      importance?: number;
      embedding?: number[];
    };

    const content = parsed.content ?? '';
    const embedding = parsed.embedding;

    const id = crypto.randomUUID();

    await knex('behavioral_templates').insert({
      id,
      situation_description: content,
      situation_category: 'feedback-migration',
      trigger_patterns: JSON.stringify([content]),
      strategy: JSON.stringify({
        approach: content,
        guidelines: ['Migrated from feedback memory'],
      }),
      total_interactions: 1,
      positive_outcomes: 0,
      negative_outcomes: 1,
      neutral_outcomes: 0,
      last_outcomes: JSON.stringify([
        {
          timestamp: row.created_at,
          signal: 'correction',
          detail: content,
        },
      ]),
      confidence_score: 0.5,
      embedding: embedding ? embeddingToBuffer(embedding) : null,
      activation_score: 0.5,
      status: 'active',
      created_at: row.created_at,
      updated_at: now,
    });

    // Delete from store_embedding_index first (references store_items)
    await knex('store_embedding_index').where({ namespace: row.namespace, key: row.key }).delete();

    // Delete from store_items
    await knex('store_items').where({ namespace: row.namespace, key: row.key }).delete();
  }
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const down = async (_knex: Knex): Promise<void> => {
  // Forward-only migration — no rollback
};

export { up, down };
