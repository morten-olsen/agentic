import { z } from 'zod';

const databaseConfigSchema = z.object({
  /** Path to the SQLite database file. Use ':memory:' for in-memory database. */
  path: z.string().default('./data/glados.db'),
});

type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

export type { DatabaseConfig };
export { databaseConfigSchema };
