import { z } from 'zod';

/**
 * Schema for a whitelisted domain.
 */
const whitelistedDomainSchema = z.object({
  domain: z.string().min(1),
  addedAt: z.string(),
  addedByConversationId: z.string().nullable(),
  reason: z.string().nullable(),
});

type WhitelistedDomain = z.infer<typeof whitelistedDomainSchema>;

/**
 * Database row for domain whitelist.
 */
type WhitelistedDomainRow = {
  domain: string;
  added_at: string;
  added_by_conversation_id: string | null;
  reason: string | null;
};

export type { WhitelistedDomain, WhitelistedDomainRow };
export { whitelistedDomainSchema };
