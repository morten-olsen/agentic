import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolRegistry } from '../tools.ts';
import { DomainWhitelistService } from '../../../features/risk-policies/risk-policies.ts';

// ============================================================================
// whitelist_domain Tool
// ============================================================================

const whitelistDomainInputSchema = z.object({
  domain: z.string().min(1).describe('The domain to whitelist (e.g., "api.example.com", "example.com")'),
  reason: z.string().optional().describe('Optional reason for whitelisting this domain'),
});

type WhitelistDomainInput = z.input<typeof whitelistDomainInputSchema>;

const whitelistDomainOutputSchema = z.object({
  success: z.boolean(),
  domain: z.string(),
  message: z.string(),
});

type WhitelistDomainOutput = z.infer<typeof whitelistDomainOutputSchema>;

const whitelistDomainExecute = async (
  input: WhitelistDomainInput,
  context: ToolContext,
): Promise<WhitelistDomainOutput> => {
  const parsed = whitelistDomainInputSchema.parse(input);
  const whitelistService = context.services.get(DomainWhitelistService);

  const result = await whitelistService.add(parsed.domain, context.conversationId, parsed.reason);

  return {
    success: true,
    domain: result.domain,
    message: `Domain "${result.domain}" has been added to the whitelist. Future web.fetch requests to this domain (and its subdomains) will be low-risk and won't require approval.`,
  };
};

const whitelistDomainTool: ToolDefinition<WhitelistDomainInput, WhitelistDomainOutput> = {
  id: 'security.whitelist_domain',
  name: 'Whitelist Domain',
  description:
    'Adds a domain to the trusted whitelist. Once whitelisted, web.fetch requests to this domain (and its subdomains) will be treated as low-risk and not require approval. Use this when the user regularly accesses a specific API or website.',
  category: 'security',
  inputSchema: whitelistDomainInputSchema,
  outputSchema: whitelistDomainOutputSchema,
  risk: {
    level: 'medium',
    reason: 'Modifies security policy by trusting a new domain',
    potentialImpact: 'Future requests to this domain will bypass approval',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['security', 'whitelist', 'domain', 'policy'],
  examples: [
    {
      input: { domain: 'api.github.com' },
      description: 'Whitelist GitHub API for trusted access',
    },
    {
      input: { domain: 'docs.example.com', reason: 'Company documentation site' },
      description: 'Whitelist with a reason for audit purposes',
    },
  ],
  execute: whitelistDomainExecute,
};

// ============================================================================
// remove_whitelisted_domain Tool
// ============================================================================

const removeWhitelistedDomainInputSchema = z.object({
  domain: z.string().min(1).describe('The domain to remove from the whitelist'),
});

type RemoveWhitelistedDomainInput = z.input<typeof removeWhitelistedDomainInputSchema>;

const removeWhitelistedDomainOutputSchema = z.object({
  success: z.boolean(),
  domain: z.string(),
  message: z.string(),
});

type RemoveWhitelistedDomainOutput = z.infer<typeof removeWhitelistedDomainOutputSchema>;

const removeWhitelistedDomainExecute = async (
  input: RemoveWhitelistedDomainInput,
  context: ToolContext,
): Promise<RemoveWhitelistedDomainOutput> => {
  const parsed = removeWhitelistedDomainInputSchema.parse(input);
  const whitelistService = context.services.get(DomainWhitelistService);

  const removed = await whitelistService.remove(parsed.domain);

  if (removed) {
    return {
      success: true,
      domain: parsed.domain.toLowerCase().trim(),
      message: `Domain "${parsed.domain}" has been removed from the whitelist. Future requests to this domain will require approval.`,
    };
  }

  return {
    success: false,
    domain: parsed.domain.toLowerCase().trim(),
    message: `Domain "${parsed.domain}" was not found in the whitelist.`,
  };
};

const removeWhitelistedDomainTool: ToolDefinition<RemoveWhitelistedDomainInput, RemoveWhitelistedDomainOutput> = {
  id: 'security.remove_whitelisted_domain',
  name: 'Remove Whitelisted Domain',
  description:
    'Removes a domain from the trusted whitelist. After removal, web.fetch requests to this domain will require approval again.',
  category: 'security',
  inputSchema: removeWhitelistedDomainInputSchema,
  outputSchema: removeWhitelistedDomainOutputSchema,
  risk: {
    level: 'low',
    reason: 'Removes trust from a domain (more restrictive)',
    potentialImpact: 'Future requests to this domain will require approval',
    reversible: true,
    categories: ['data_modification'],
  },
  tags: ['security', 'whitelist', 'domain', 'policy'],
  examples: [
    {
      input: { domain: 'untrusted.com' },
      description: 'Remove a domain from the whitelist',
    },
  ],
  execute: removeWhitelistedDomainExecute,
};

// ============================================================================
// list_whitelisted_domains Tool
// ============================================================================

const listWhitelistedDomainsInputSchema = z.object({});

type ListWhitelistedDomainsInput = z.input<typeof listWhitelistedDomainsInputSchema>;

const listWhitelistedDomainsOutputSchema = z.object({
  domains: z.array(
    z.object({
      domain: z.string(),
      addedAt: z.string(),
      reason: z.string().nullable(),
    }),
  ),
  count: z.number(),
});

type ListWhitelistedDomainsOutput = z.infer<typeof listWhitelistedDomainsOutputSchema>;

const listWhitelistedDomainsExecute = async (
  _input: ListWhitelistedDomainsInput,
  context: ToolContext,
): Promise<ListWhitelistedDomainsOutput> => {
  const whitelistService = context.services.get(DomainWhitelistService);
  const domains = await whitelistService.list();

  return {
    domains: domains.map((d) => ({
      domain: d.domain,
      addedAt: d.addedAt,
      reason: d.reason,
    })),
    count: domains.length,
  };
};

const listWhitelistedDomainsTool: ToolDefinition<ListWhitelistedDomainsInput, ListWhitelistedDomainsOutput> = {
  id: 'security.list_whitelisted_domains',
  name: 'List Whitelisted Domains',
  description:
    'Lists all domains currently in the trusted whitelist. These domains have low-risk access for web.fetch requests.',
  category: 'security',
  inputSchema: listWhitelistedDomainsInputSchema,
  outputSchema: listWhitelistedDomainsOutputSchema,
  risk: {
    level: 'low',
    reason: 'Read-only access to whitelist',
    potentialImpact: 'None - informational only',
    reversible: true,
    categories: ['data_access'],
  },
  tags: ['security', 'whitelist', 'domain', 'policy'],
  examples: [
    {
      input: {},
      description: 'List all whitelisted domains',
    },
  ],
  execute: listWhitelistedDomainsExecute,
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Registers all domain whitelist tools with the registry.
 */
const registerDomainWhitelistTools = (registry: ToolRegistry): void => {
  registry.register(whitelistDomainTool);
  registry.register(removeWhitelistedDomainTool);
  registry.register(listWhitelistedDomainsTool);
};

export type {
  WhitelistDomainInput,
  WhitelistDomainOutput,
  RemoveWhitelistedDomainInput,
  RemoveWhitelistedDomainOutput,
  ListWhitelistedDomainsInput,
  ListWhitelistedDomainsOutput,
};

export { whitelistDomainTool, removeWhitelistedDomainTool, listWhitelistedDomainsTool, registerDomainWhitelistTools };
