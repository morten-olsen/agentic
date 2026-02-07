import { createInvalidUrlError, createBlockedError } from './web-fetch.errors.ts';

// ============================================================================
// URL Validation and SSRF Protection
// ============================================================================

/**
 * Private IP ranges that should be blocked.
 */
const PRIVATE_IP_PATTERNS = [
  // Localhost
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^::1$/,
  /^0\.0\.0\.0$/,
  // Private ranges
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  // Link-local
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  // IPv6 link-local
  /^fe80:/i,
  // IPv6 unique local
  /^f[cd][0-9a-f]{2}:/i,
];

/**
 * Blocked hostnames for SSRF protection.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  '[::1]',
  // Cloud metadata endpoints
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.gcp.internal',
]);

/**
 * Checks if a hostname or IP is private/blocked.
 */
const isPrivateHost = (hostname: string): boolean => {
  // Check exact hostname matches
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    return true;
  }

  // Check IP patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  return false;
};

/**
 * Validates and parses a URL string.
 * Returns the parsed URL or throws a WebFetchError.
 */
const validateUrl = (urlString: string): URL => {
  let url: URL;

  try {
    url = new URL(urlString);
  } catch {
    throw createInvalidUrlError(urlString, 'Malformed URL');
  }

  // Only allow http and https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createInvalidUrlError(urlString, `Protocol ${url.protocol} not allowed`);
  }

  // SSRF protection
  if (isPrivateHost(url.hostname)) {
    throw createBlockedError(urlString, 'Requests to private/internal addresses are not allowed');
  }

  return url;
};

// ============================================================================
// HTML Extraction Utilities
// ============================================================================

/**
 * Extracts the page title from HTML.
 */
const extractTitle = (html: string): string | null => {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch?.[1]) {
    // Decode HTML entities
    return decodeHtmlEntities(titleMatch[1].trim());
  }
  return null;
};

/**
 * Decodes common HTML entities.
 */
const decodeHtmlEntities = (text: string): string => {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replaceAll(entity, char);
  }

  // Handle numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  return result;
};

/**
 * Link extracted from HTML.
 */
type ExtractedLink = {
  url: string;
  text: string;
};

/**
 * Extracts anchor tags from HTML with resolved URLs.
 */
const extractLinks = (html: string, baseUrl: string): ExtractedLink[] => {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  // Match anchor tags
  const anchorRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    const innerHtml = match[2] ?? '';

    // Skip empty hrefs, anchors, and javascript
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) {
      continue;
    }

    try {
      // Resolve relative URLs
      const resolvedUrl = new URL(href, baseUrl).href;

      // Deduplicate
      if (seen.has(resolvedUrl)) {
        continue;
      }
      seen.add(resolvedUrl);

      // Extract text content (strip HTML tags)
      const text = stripHtmlTags(innerHtml).trim();

      links.push({
        url: resolvedUrl,
        text: text || resolvedUrl,
      });
    } catch {
      // Skip invalid URLs
    }
  }

  return links;
};

/**
 * Strips HTML tags from a string.
 */
const stripHtmlTags = (html: string): string => {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
};

// ============================================================================
// HTML to Markdown Conversion
// ============================================================================

/**
 * Converts HTML to markdown.
 * This is a simplified implementation that handles common elements.
 */
const htmlToMarkdown = (html: string): string => {
  let markdown = html;

  // Remove script and style elements
  markdown = markdown.replace(/<script[\s\S]*?<\/script>/gi, '');
  markdown = markdown.replace(/<style[\s\S]*?<\/style>/gi, '');
  markdown = markdown.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Remove HTML comments
  markdown = markdown.replace(/<!--[\s\S]*?-->/g, '');

  // Remove head section
  markdown = markdown.replace(/<head[\s\S]*?<\/head>/gi, '');

  // Remove nav, header, footer, aside (often navigation/boilerplate)
  markdown = markdown.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  markdown = markdown.replace(/<header[\s\S]*?<\/header>/gi, '');
  markdown = markdown.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  markdown = markdown.replace(/<aside[\s\S]*?<\/aside>/gi, '');

  // Convert headings
  markdown = markdown.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  markdown = markdown.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  markdown = markdown.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  markdown = markdown.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  markdown = markdown.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  markdown = markdown.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  // Convert paragraphs
  markdown = markdown.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');

  // Convert line breaks
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

  // Convert horizontal rules
  markdown = markdown.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Convert bold
  markdown = markdown.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');

  // Convert italic
  markdown = markdown.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Convert code blocks
  markdown = markdown.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  markdown = markdown.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

  // Convert inline code
  markdown = markdown.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Convert blockquotes
  markdown = markdown.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const lines = content.split('\n');
    return '\n' + lines.map((line: string) => `> ${line}`).join('\n') + '\n';
  });

  // Convert unordered lists
  markdown = markdown.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return '\n' + content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n') + '\n';
  });

  // Convert ordered lists
  markdown = markdown.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let index = 1;
    return (
      '\n' +
      content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => {
        return `${index++}. ` + content.match(/<li[^>]*>([\s\S]*?)<\/li>/i)?.[1] + '\n';
      }) +
      '\n'
    );
  });

  // Better ordered list handling
  markdown = markdown.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match) => {
    let index = 1;
    const items: string[] = [];
    const itemRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(match)) !== null) {
      items.push(`${index++}. ${itemMatch[1]}`);
    }
    return '\n' + items.join('\n') + '\n';
  });

  // Convert links
  markdown = markdown.replace(/<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert images
  markdown = markdown.replace(
    /<img[^>]*alt\s*=\s*["']([^"']*)["'][^>]*src\s*=\s*["']([^"']+)["'][^>]*\/?>/gi,
    '![$1]($2)',
  );
  markdown = markdown.replace(
    /<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*alt\s*=\s*["']([^"']*)["'][^>]*\/?>/gi,
    '![$2]($1)',
  );
  markdown = markdown.replace(/<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*\/?>/gi, '![]($1)');

  // Convert tables (simplified)
  markdown = markdown.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, content) => {
    const rows: string[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let isHeader = true;

    while ((rowMatch = rowRegex.exec(content)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
      let cellMatch;

      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(stripHtmlTags(cellMatch[2]).trim());
      }

      if (cells.length > 0) {
        rows.push('| ' + cells.join(' | ') + ' |');

        // Add header separator after first row
        if (isHeader) {
          rows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
          isHeader = false;
        }
      }
    }

    return '\n' + rows.join('\n') + '\n';
  });

  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  markdown = decodeHtmlEntities(markdown);

  // Clean up whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  markdown = markdown.trim();

  return markdown;
};

export type { ExtractedLink };
export { validateUrl, isPrivateHost, extractTitle, extractLinks, htmlToMarkdown, decodeHtmlEntities, stripHtmlTags };
