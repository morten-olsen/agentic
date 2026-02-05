import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse, delay } from 'msw';

import { createDatabaseService, DatabaseService } from '../../database/database.ts';
import { ArtifactService } from '../../artifacts/artifacts.ts';
import { Services } from '../../services/services.ts';
import type { ToolContext } from '../tools.ts';
import { server } from '../../../test/setup.ts';

import { webFetchTool } from './web-fetch.ts';
import { WebFetchError } from './web-fetch.errors.ts';
import { validateUrl, isPrivateHost, extractTitle, extractLinks, htmlToMarkdown } from './web-fetch.utils.ts';

// ============================================================================
// Utility Tests
// ============================================================================

describe('web-fetch utilities', () => {
  describe('isPrivateHost', () => {
    it('blocks localhost', () => {
      expect(isPrivateHost('localhost')).toBe(true);
      expect(isPrivateHost('LOCALHOST')).toBe(true);
    });

    it('blocks loopback addresses', () => {
      expect(isPrivateHost('127.0.0.1')).toBe(true);
      expect(isPrivateHost('127.0.0.2')).toBe(true);
      expect(isPrivateHost('127.255.255.255')).toBe(true);
      expect(isPrivateHost('::1')).toBe(true);
    });

    it('blocks private IP ranges', () => {
      // 10.x.x.x
      expect(isPrivateHost('10.0.0.1')).toBe(true);
      expect(isPrivateHost('10.255.255.255')).toBe(true);

      // 172.16-31.x.x
      expect(isPrivateHost('172.16.0.1')).toBe(true);
      expect(isPrivateHost('172.31.255.255')).toBe(true);
      expect(isPrivateHost('172.15.0.1')).toBe(false); // Not in range
      expect(isPrivateHost('172.32.0.1')).toBe(false); // Not in range

      // 192.168.x.x
      expect(isPrivateHost('192.168.0.1')).toBe(true);
      expect(isPrivateHost('192.168.255.255')).toBe(true);
    });

    it('blocks link-local addresses', () => {
      expect(isPrivateHost('169.254.0.1')).toBe(true);
      expect(isPrivateHost('169.254.169.254')).toBe(true);
    });

    it('blocks cloud metadata endpoints', () => {
      expect(isPrivateHost('169.254.169.254')).toBe(true);
      expect(isPrivateHost('metadata.google.internal')).toBe(true);
    });

    it('allows public addresses', () => {
      expect(isPrivateHost('8.8.8.8')).toBe(false);
      expect(isPrivateHost('example.com')).toBe(false);
      expect(isPrivateHost('google.com')).toBe(false);
    });
  });

  describe('validateUrl', () => {
    it('accepts valid HTTP/HTTPS URLs', () => {
      const httpsUrl = validateUrl('https://example.com');
      expect(httpsUrl.protocol).toBe('https:');

      const httpUrl = validateUrl('http://example.com');
      expect(httpUrl.protocol).toBe('http:');
    });

    it('rejects invalid URLs', () => {
      expect(() => validateUrl('not-a-url')).toThrow(WebFetchError);
      expect(() => validateUrl('')).toThrow(WebFetchError);
    });

    it('rejects non-HTTP protocols', () => {
      expect(() => validateUrl('ftp://example.com')).toThrow(WebFetchError);
      expect(() => validateUrl('file:///etc/passwd')).toThrow(WebFetchError);
      expect(() => validateUrl('javascript:alert(1)')).toThrow(WebFetchError);
    });

    it('rejects private addresses', () => {
      expect(() => validateUrl('http://localhost')).toThrow(WebFetchError);
      expect(() => validateUrl('http://127.0.0.1')).toThrow(WebFetchError);
      expect(() => validateUrl('http://192.168.1.1')).toThrow(WebFetchError);
      expect(() => validateUrl('http://169.254.169.254')).toThrow(WebFetchError);
    });
  });

  describe('extractTitle', () => {
    it('extracts title from HTML', () => {
      const html = '<html><head><title>Test Page</title></head><body></body></html>';
      expect(extractTitle(html)).toBe('Test Page');
    });

    it('handles title with whitespace', () => {
      const html = '<html><head><title>  Test Page  </title></head></html>';
      expect(extractTitle(html)).toBe('Test Page');
    });

    it('decodes HTML entities in title', () => {
      const html = '<html><head><title>Test &amp; Page</title></head></html>';
      expect(extractTitle(html)).toBe('Test & Page');
    });

    it('returns null when no title', () => {
      const html = '<html><head></head><body></body></html>';
      expect(extractTitle(html)).toBeNull();
    });
  });

  describe('extractLinks', () => {
    it('extracts links with resolved URLs', () => {
      const html = '<a href="/page">Link</a>';
      const links = extractLinks(html, 'https://example.com');

      expect(links).toHaveLength(1);
      expect(links[0]?.url).toBe('https://example.com/page');
      expect(links[0]?.text).toBe('Link');
    });

    it('handles absolute URLs', () => {
      const html = '<a href="https://other.com/page">Link</a>';
      const links = extractLinks(html, 'https://example.com');

      expect(links).toHaveLength(1);
      expect(links[0]?.url).toBe('https://other.com/page');
    });

    it('deduplicates links', () => {
      const html = '<a href="/page">Link 1</a><a href="/page">Link 2</a>';
      const links = extractLinks(html, 'https://example.com');

      expect(links).toHaveLength(1);
    });

    it('skips anchor-only links', () => {
      const html = '<a href="#section">Anchor</a>';
      const links = extractLinks(html, 'https://example.com');

      expect(links).toHaveLength(0);
    });

    it('skips javascript: links', () => {
      const html = '<a href="javascript:void(0)">JS</a>';
      const links = extractLinks(html, 'https://example.com');

      expect(links).toHaveLength(0);
    });

    it('strips HTML from link text', () => {
      const html = '<a href="/page"><strong>Bold</strong> text</a>';
      const links = extractLinks(html, 'https://example.com');

      expect(links[0]?.text).toBe('Bold text');
    });
  });

  describe('htmlToMarkdown', () => {
    it('converts headings', () => {
      const html = '<h1>Title</h1><h2>Subtitle</h2>';
      const md = htmlToMarkdown(html);

      expect(md).toContain('# Title');
      expect(md).toContain('## Subtitle');
    });

    it('converts paragraphs', () => {
      const html = '<p>First paragraph</p><p>Second paragraph</p>';
      const md = htmlToMarkdown(html);

      expect(md).toContain('First paragraph');
      expect(md).toContain('Second paragraph');
    });

    it('converts bold and italic', () => {
      const html = '<strong>bold</strong> and <em>italic</em>';
      const md = htmlToMarkdown(html);

      expect(md).toContain('**bold**');
      expect(md).toContain('*italic*');
    });

    it('converts links', () => {
      const html = '<a href="https://example.com">Link</a>';
      const md = htmlToMarkdown(html);

      expect(md).toContain('[Link](https://example.com)');
    });

    it('converts code blocks', () => {
      const html = '<pre><code>const x = 1;</code></pre>';
      const md = htmlToMarkdown(html);

      expect(md).toContain('```');
      expect(md).toContain('const x = 1;');
    });

    it('converts inline code', () => {
      const html = 'Use <code>npm install</code> to install';
      const md = htmlToMarkdown(html);

      expect(md).toContain('`npm install`');
    });

    it('converts unordered lists', () => {
      const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      const md = htmlToMarkdown(html);

      expect(md).toContain('- Item 1');
      expect(md).toContain('- Item 2');
    });

    it('removes script and style tags', () => {
      const html = '<script>alert(1)</script><style>.x{}</style><p>Content</p>';
      const md = htmlToMarkdown(html);

      expect(md).not.toContain('alert');
      expect(md).not.toContain('.x{}');
      expect(md).toContain('Content');
    });

    it('removes nav, header, footer, aside', () => {
      const html = '<nav>Nav</nav><header>Header</header><main>Main</main><footer>Footer</footer>';
      const md = htmlToMarkdown(html);

      expect(md).not.toContain('Nav');
      expect(md).not.toContain('Header');
      expect(md).not.toContain('Footer');
      expect(md).toContain('Main');
    });

    it('decodes HTML entities', () => {
      const html = '<p>Hello &amp; goodbye &lt;world&gt;</p>';
      const md = htmlToMarkdown(html);

      expect(md).toContain('Hello & goodbye <world>');
    });
  });
});

// ============================================================================
// Tool Tests
// ============================================================================

describe('webFetchTool', () => {
  let services: Services;
  let context: ToolContext;

  beforeEach(async () => {
    services = new Services();

    const dbService = createDatabaseService(services, { path: ':memory:' });
    services.set(DatabaseService, dbService);
    await dbService.migrate();

    services.set(ArtifactService, new ArtifactService(services));

    context = {
      userId: 'test-user',
      conversationId: 'test-conversation',
      services,
    };
  });

  describe('tool definition', () => {
    it('has correct metadata', () => {
      expect(webFetchTool.id).toBe('web.fetch');
      expect(webFetchTool.name).toBe('Fetch Web Page');
      expect(webFetchTool.category).toBe('web');
      expect(webFetchTool.risk.level).toBe('medium');
      expect(webFetchTool.risk.categories).toContain('external_communication');
    });
  });

  describe('article mode', () => {
    it('extracts title, markdown, and links', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Test Page</title></head>
        <body>
          <h1>Welcome</h1>
          <p>This is a <strong>test</strong> page.</p>
          <a href="/about">About Us</a>
          <a href="https://external.com">External</a>
        </body>
        </html>
      `;

      server.use(
        http.get('https://example.com/', () => {
          return new HttpResponse(html, {
            headers: { 'Content-Type': 'text/html' },
          });
        }),
      );

      const result = await webFetchTool.execute({ url: 'https://example.com/' }, context);

      expect(result.format).toBe('article');
      if (result.format === 'article') {
        expect(result.title).toBe('Test Page');
        expect(result.markdown).toContain('# Welcome');
        expect(result.markdown).toContain('**test**');
        expect(result.links).toHaveLength(2);
        expect(result.links[0]?.url).toBe('https://example.com/about');
        expect(result.links[1]?.url).toBe('https://external.com/');
        expect(result.fetchedAt).toBeDefined();
      }
    });

    it('handles pages without title', async () => {
      const html = '<html><body><p>No title</p></body></html>';

      server.use(
        http.get('https://example.com/', () => {
          return new HttpResponse(html, {
            headers: { 'Content-Type': 'text/html' },
          });
        }),
      );

      const result = await webFetchTool.execute({ url: 'https://example.com/' }, context);

      expect(result.format).toBe('article');
      if (result.format === 'article') {
        expect(result.title).toBeNull();
      }
    });
  });

  describe('raw mode', () => {
    it('returns raw HTML', async () => {
      const html = '<html><body><p>Hello</p></body></html>';

      server.use(
        http.get('https://example.com/', () => {
          return new HttpResponse(html, {
            headers: { 'Content-Type': 'text/html' },
          });
        }),
      );

      const result = await webFetchTool.execute({ url: 'https://example.com/', outputFormat: 'raw' }, context);

      expect(result.format).toBe('raw');
      if (result.format === 'raw') {
        expect(result.html).toContain('<p>Hello</p>');
        expect(result.statusCode).toBe(200);
        expect(result.contentType).toContain('text/html');
      }
    });
  });

  describe('redirect handling', () => {
    it('follows redirects and reports final URL', async () => {
      server.use(
        http.get('https://example.com/old', () => {
          return new HttpResponse(null, {
            status: 301,
            headers: { Location: 'https://example.com/new' },
          });
        }),
        http.get('https://example.com/new', () => {
          return new HttpResponse('<html><body>Redirected</body></html>', {
            headers: { 'Content-Type': 'text/html' },
          });
        }),
      );

      const result = await webFetchTool.execute({ url: 'https://example.com/old' }, context);

      expect(result.url).toBe('https://example.com/old');
      expect(result.finalUrl).toBe('https://example.com/new');
    });
  });

  describe('SSRF protection', () => {
    it('blocks localhost', async () => {
      await expect(webFetchTool.execute({ url: 'http://localhost/' }, context)).rejects.toThrow(WebFetchError);
    });

    it('blocks private IP addresses', async () => {
      await expect(webFetchTool.execute({ url: 'http://192.168.1.1/' }, context)).rejects.toThrow(WebFetchError);

      await expect(webFetchTool.execute({ url: 'http://10.0.0.1/' }, context)).rejects.toThrow(WebFetchError);

      await expect(webFetchTool.execute({ url: 'http://172.16.0.1/' }, context)).rejects.toThrow(WebFetchError);
    });

    it('blocks cloud metadata endpoints', async () => {
      await expect(webFetchTool.execute({ url: 'http://169.254.169.254/latest/meta-data/' }, context)).rejects.toThrow(
        WebFetchError,
      );
    });
  });

  describe('error handling', () => {
    it('throws on non-HTML content', async () => {
      server.use(
        http.get('https://test-web-fetch.example.com/files/image', () => {
          return new HttpResponse('binary data', {
            headers: { 'Content-Type': 'image/png' },
          });
        }),
      );

      await expect(
        webFetchTool.execute({ url: 'https://test-web-fetch.example.com/files/image' }, context),
      ).rejects.toThrow(WebFetchError);
    });

    it('throws on HTTP error status', async () => {
      server.use(
        http.get('https://example.com/404', () => {
          return new HttpResponse('Not Found', { status: 404 });
        }),
      );

      await expect(webFetchTool.execute({ url: 'https://example.com/404' }, context)).rejects.toThrow(WebFetchError);
    });

    it('throws on timeout', async () => {
      server.use(
        http.get('https://example.com/slow', async () => {
          await delay(5000); // Longer than timeout
          return new HttpResponse('<html></html>', {
            headers: { 'Content-Type': 'text/html' },
          });
        }),
      );

      await expect(webFetchTool.execute({ url: 'https://example.com/slow', timeout: 1000 }, context)).rejects.toThrow(
        WebFetchError,
      );
    }, 10000);

    it('throws when response exceeds size limit', async () => {
      const largeContent = 'x'.repeat(100000); // 100KB

      server.use(
        http.get('https://example.com/large', () => {
          return new HttpResponse(`<html><body>${largeContent}</body></html>`, {
            headers: { 'Content-Type': 'text/html' },
          });
        }),
      );

      await expect(webFetchTool.execute({ url: 'https://example.com/large', maxSize: 1024 }, context)).rejects.toThrow(
        WebFetchError,
      );
    });
  });

  describe('content type handling', () => {
    it('accepts text/html', async () => {
      server.use(
        http.get('https://example.com/', () => {
          return new HttpResponse('<html></html>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }),
      );

      const result = await webFetchTool.execute({ url: 'https://example.com/' }, context);
      expect(result.format).toBe('article');
    });

    it('accepts application/xhtml+xml', async () => {
      server.use(
        http.get('https://example.com/', () => {
          return new HttpResponse('<html></html>', {
            headers: { 'Content-Type': 'application/xhtml+xml' },
          });
        }),
      );

      const result = await webFetchTool.execute({ url: 'https://example.com/' }, context);
      expect(result.format).toBe('article');
    });

    it('accepts text/plain', async () => {
      server.use(
        http.get('https://example.com/', () => {
          return new HttpResponse('Plain text content', {
            headers: { 'Content-Type': 'text/plain' },
          });
        }),
      );

      const result = await webFetchTool.execute({ url: 'https://example.com/' }, context);
      expect(result.format).toBe('article');
    });
  });

  describe('large content handling', () => {
    it('truncates large markdown content', async () => {
      // Generate content larger than ARTIFACT_THRESHOLD_BYTES (100KB)
      const largeContent = 'x'.repeat(150 * 1024);
      const html = `<html><body><p>${largeContent}</p></body></html>`;

      server.use(
        http.get('https://test-web-fetch.example.com/large-page', () => {
          return new HttpResponse(html, {
            headers: { 'Content-Type': 'text/html' },
          });
        }),
      );

      const result = await webFetchTool.execute({ url: 'https://test-web-fetch.example.com/large-page' }, context);

      expect(result.format).toBe('article');
      if (result.format === 'article') {
        // Content should be truncated
        expect(result.markdown).toContain('[Content truncated');
        // The markdown should be smaller than the original
        expect(result.markdown.length).toBeLessThan(largeContent.length);
      }
    });

    it('always includes complete links even when content is truncated', async () => {
      // Generate content larger than threshold with many links
      const links = Array.from({ length: 50 }, (_, i) => `<a href="/page${i}">Link ${i}</a>`).join('\n');
      const largeContent = 'x'.repeat(150 * 1024);
      const html = `<html><body>${links}<p>${largeContent}</p></body></html>`;

      server.use(
        http.get('https://test-web-fetch.example.com/many-links-page', () => {
          return new HttpResponse(html, {
            headers: { 'Content-Type': 'text/html' },
          });
        }),
      );

      const result = await webFetchTool.execute({ url: 'https://test-web-fetch.example.com/many-links-page' }, context);

      expect(result.format).toBe('article');
      if (result.format === 'article') {
        // All 50 links should be present even when content is truncated
        expect(result.links).toHaveLength(50);
        expect(result.markdown).toContain('[Content truncated');
      }
    });
  });
});
