import { z } from 'zod';

import type { Services } from '../../../core/services/services.ts';
import { ArtifactService } from '../../../features/artifacts/artifacts.ts';
import { DomainWhitelistService } from '../../../features/risk-policies/risk-policies.ts';
import type { ToolDefinition, ToolContext, RiskProfile, DynamicRiskProfile } from '../tools.ts';

import {
  WebFetchError,
  createTimeoutError,
  createNetworkError,
  createSizeLimitError,
  createNotHtmlError,
  createFetchFailedError,
} from './web-fetch.errors.ts';
import { validateUrl, extractTitle, extractLinks, htmlToMarkdown } from './web-fetch.utils.ts';
import type { ExtractedLink } from './web-fetch.utils.ts';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60000;

const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MIN_MAX_SIZE_BYTES = 1024; // 1KB
const MAX_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const USER_AGENT = 'GLaDOS/1.0 (AI Assistant)';

/** Threshold for storing content in artifacts (100KB) */
const ARTIFACT_THRESHOLD_BYTES = 100 * 1024;

/** Max size for truncated markdown in response (~50KB) */
const TRUNCATED_MARKDOWN_SIZE = 50 * 1024;

// ============================================================================
// Schemas
// ============================================================================

/**
 * Input schema for the web fetch tool.
 */
const webFetchInputSchema = z.object({
  url: z.string().describe('The URL to fetch content from'),
  outputFormat: z
    .enum(['raw', 'article'])
    .nullish()
    .default('article')
    .describe('Output format: raw returns HTML, article extracts markdown and links'),
  timeout: z
    .number()
    .int()
    .min(MIN_TIMEOUT_MS)
    .max(MAX_TIMEOUT_MS)
    .nullish()
    .default(DEFAULT_TIMEOUT_MS)
    .describe('Request timeout in milliseconds (1000-60000)'),
  maxSize: z
    .number()
    .int()
    .min(MIN_MAX_SIZE_BYTES)
    .max(MAX_MAX_SIZE_BYTES)
    .nullish()
    .default(DEFAULT_MAX_SIZE_BYTES)
    .describe('Maximum response size in bytes (1KB-10MB)'),
});

type WebFetchInput = z.input<typeof webFetchInputSchema>;

/**
 * Raw output format schema.
 */
const webFetchRawOutputSchema = z.object({
  format: z.literal('raw'),
  url: z.string(),
  finalUrl: z.string(),
  contentType: z.string(),
  statusCode: z.number(),
  html: z.string(),
  fetchedAt: z.string(),
  artifactId: z.string().optional(),
});

type WebFetchRawOutput = z.infer<typeof webFetchRawOutputSchema>;

/**
 * Link schema for article output.
 */
const extractedLinkSchema = z.object({
  url: z.string(),
  text: z.string(),
});

/**
 * Article output format schema.
 */
const webFetchArticleOutputSchema = z.object({
  format: z.literal('article'),
  url: z.string(),
  finalUrl: z.string(),
  title: z.string().nullable(),
  markdown: z.string(),
  links: z.array(extractedLinkSchema),
  fetchedAt: z.string(),
  artifactId: z.string().optional(),
});

type WebFetchArticleOutput = z.infer<typeof webFetchArticleOutputSchema>;

/**
 * Combined output schema (discriminated union).
 */
const webFetchOutputSchema = z.discriminatedUnion('format', [webFetchRawOutputSchema, webFetchArticleOutputSchema]);

type WebFetchOutput = z.infer<typeof webFetchOutputSchema>;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Fetches content from a URL with streaming size limit.
 */
const fetchWithSizeLimit = async (
  url: URL,
  timeout: number,
  maxSize: number,
  abortSignal?: AbortSignal,
): Promise<{ response: Response; html: string }> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Combine with external abort signal
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(url.href, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw createFetchFailedError(url.href, response.status, response.statusText);
    }

    // Check content type
    const contentType = response.headers.get('content-type') ?? '';
    const isHtml =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml+xml') ||
      contentType.includes('text/plain');

    if (!isHtml) {
      throw createNotHtmlError(url.href, contentType);
    }

    // Stream response body with size limit
    const reader = response.body?.getReader();
    if (!reader) {
      throw createNetworkError(url.href, 'No response body');
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > maxSize) {
        reader.cancel();
        throw createSizeLimitError(url.href, totalSize, maxSize);
      }

      chunks.push(value);
    }

    const decoder = new TextDecoder('utf-8');
    const html = chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();

    return { response, html };
  } catch (error) {
    if (error instanceof WebFetchError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw createTimeoutError(url.href, timeout);
      }
      throw createNetworkError(url.href, error.message);
    }

    throw createNetworkError(url.href, String(error));
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Truncates markdown content and adds truncation notice.
 */
const truncateMarkdown = (markdown: string, maxSize: number): string => {
  if (markdown.length <= maxSize) {
    return markdown;
  }

  // Find a good break point (paragraph or line break)
  let breakPoint = markdown.lastIndexOf('\n\n', maxSize);
  if (breakPoint === -1 || breakPoint < maxSize * 0.5) {
    breakPoint = markdown.lastIndexOf('\n', maxSize);
  }
  if (breakPoint === -1 || breakPoint < maxSize * 0.5) {
    breakPoint = maxSize;
  }

  return markdown.slice(0, breakPoint) + '\n\n[Content truncated - use get_artifact to retrieve full content]';
};

/**
 * Stores large content in artifacts and returns the artifact ID.
 * Returns undefined if storage fails for any reason (graceful degradation).
 */
const storeInArtifact = async (
  context: ToolContext,
  _url: string,
  data: { html: string; markdown?: string; title?: string | null },
): Promise<string | undefined> => {
  try {
    const artifactService = context.services.get(ArtifactService);
    if (!artifactService) {
      return undefined;
    }

    const messageId = context.messageId ?? context.conversationId;

    const result = await artifactService.store(context.conversationId, messageId, 'web_fetch', data, {
      mimeType: 'application/json',
      ttlMinutes: 60,
      summaryProvided: true,
    });

    return result.id;
  } catch {
    // Gracefully handle artifact storage failures (e.g., FK constraint errors)
    // The tool still returns useful content even without artifact storage
    return undefined;
  }
};

/**
 * Executes the web fetch tool.
 */
const execute = async (input: WebFetchInput, context: ToolContext): Promise<WebFetchOutput> => {
  // Parse and validate with defaults
  const parsed = webFetchInputSchema.parse(input);
  const { url: urlString, outputFormat, timeout, maxSize } = parsed;

  // Validate URL (includes SSRF protection)
  const url = validateUrl(urlString);

  // Fetch content
  const { response, html } = await fetchWithSizeLimit(
    url,
    timeout ?? DEFAULT_TIMEOUT_MS,
    maxSize ?? DEFAULT_MAX_SIZE_BYTES,
    context.abortSignal,
  );

  const finalUrl = response.url;
  const contentType = response.headers.get('content-type') ?? 'text/html';
  const fetchedAt = new Date().toISOString();
  const contentSize = Buffer.byteLength(html, 'utf-8');

  if (outputFormat === 'raw') {
    // Check if we need to store in artifact
    let artifactId: string | undefined;
    let outputHtml = html;

    if (contentSize > ARTIFACT_THRESHOLD_BYTES) {
      artifactId = await storeInArtifact(context, finalUrl, { html });
      outputHtml = truncateMarkdown(html, TRUNCATED_MARKDOWN_SIZE);
    }

    const result: WebFetchRawOutput = {
      format: 'raw',
      url: urlString,
      finalUrl,
      contentType,
      statusCode: response.status,
      html: outputHtml,
      fetchedAt,
    };

    if (artifactId) {
      result.artifactId = artifactId;
    }

    return result;
  }

  // Article format
  const title = extractTitle(html);
  const markdown = htmlToMarkdown(html);
  const links = extractLinks(html, finalUrl);

  // Check if we need to store in artifact
  let artifactId: string | undefined;
  let outputMarkdown = markdown;

  const markdownSize = Buffer.byteLength(markdown, 'utf-8');
  if (markdownSize > ARTIFACT_THRESHOLD_BYTES || contentSize > ARTIFACT_THRESHOLD_BYTES) {
    artifactId = await storeInArtifact(context, finalUrl, { html, markdown, title });
    outputMarkdown = truncateMarkdown(markdown, TRUNCATED_MARKDOWN_SIZE);
  }

  const result: WebFetchArticleOutput = {
    format: 'article',
    url: urlString,
    finalUrl,
    title,
    markdown: outputMarkdown,
    links,
    fetchedAt,
  };

  if (artifactId) {
    result.artifactId = artifactId;
  }

  return result;
};

// ============================================================================
// Dynamic Risk Evaluation
// ============================================================================

/**
 * Default risk profile for non-whitelisted domains.
 */
const defaultWebFetchRisk: RiskProfile = {
  level: 'medium',
  reason: 'Makes external HTTP requests to arbitrary URLs',
  potentialImpact: 'Network requests to external services, potential information disclosure',
  reversible: true,
  categories: ['external_communication'],
};

/**
 * Dynamic risk evaluator for web.fetch.
 * Returns low risk for whitelisted domains, medium risk otherwise.
 */
const webFetchRiskEvaluator = async (input: WebFetchInput, services: Services): Promise<RiskProfile> => {
  try {
    // Parse the URL to extract the domain
    const parsed = webFetchInputSchema.safeParse(input);
    if (!parsed.success) {
      return defaultWebFetchRisk;
    }

    const url = new URL(parsed.data.url);
    const domain = url.hostname;

    // Check if domain is whitelisted
    const whitelistService = services.get(DomainWhitelistService);
    const isWhitelisted = await whitelistService.isWhitelisted(domain);

    if (isWhitelisted) {
      return {
        level: 'low',
        reason: `Domain "${domain}" is in the trusted whitelist`,
        potentialImpact: 'Network request to a pre-approved trusted domain',
        reversible: true,
        categories: ['external_communication'],
      };
    }
  } catch {
    // URL parsing or whitelist check failed, use default risk
  }

  return defaultWebFetchRisk;
};

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * Web fetch tool - retrieves content from URLs.
 * Uses dynamic risk evaluation based on domain whitelist.
 */
const webFetchTool: ToolDefinition<WebFetchInput, WebFetchOutput> = {
  id: 'web.fetch',
  name: 'Fetch Web Page',
  description:
    'Fetches content from a URL. In article mode (default), extracts the page title, converts HTML to markdown, and extracts all links. In raw mode, returns the raw HTML. Includes SSRF protection to block requests to private/internal addresses. Whitelisted domains are low-risk; non-whitelisted domains require approval.',
  category: 'web',
  inputSchema: webFetchInputSchema,
  outputSchema: webFetchOutputSchema,
  risk: {
    evaluator: webFetchRiskEvaluator,
    defaultProfile: defaultWebFetchRisk,
  } as DynamicRiskProfile<WebFetchInput>,
  tags: ['web', 'http', 'fetch', 'scrape'],
  examples: [
    {
      input: { url: 'https://example.com' },
      description: 'Fetch a webpage as markdown article',
    },
    {
      input: { url: 'https://example.com', outputFormat: 'raw' },
      description: 'Fetch raw HTML from a webpage',
    },
    {
      input: { url: 'https://example.com', timeout: 10000, maxSize: 1048576 },
      description: 'Fetch with custom timeout (10s) and size limit (1MB)',
    },
  ],
  execute,
};

export type { WebFetchInput, WebFetchOutput, WebFetchRawOutput, WebFetchArticleOutput, ExtractedLink };
export { webFetchTool, webFetchInputSchema, webFetchOutputSchema };
