import { Injectable, OnModuleInit } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { z } from 'zod';
import { ScrapingService } from '../scraping/scraping.service';

@Injectable()
export class McpService implements OnModuleInit {
  private sessions = new Map<string, StreamableHTTPServerTransport>();

  constructor(private readonly scrapingService: ScrapingService) {}

  onModuleInit() {}

  private createServer(): McpServer {
    const server = new McpServer({
      name: 'skinevora',
      version: '1.0.0',
    });

    server.tool(
      'push_products',
      'Push one or more skincare products to the Skinevora database. Accepts an array of product objects with camelCase keys.',
      {
        products: z.array(
          z.object({
            name: z.string(),
            brand: z.string(),
            price: z.number(),
            currency: z.string().default('INR'),
            normalizedPriceInr: z.number(),
            imageUrl: z.string().nullable().optional(),
            category: z.string().default('skin'),
            subcategory: z.string(),
            description: z.string().nullable().optional(),
            platform: z.string(),
            store: z.string(),
            size: z.string().nullable().optional(),
            quantity: z.number().nullable().optional(),
            ingredients: z.string().nullable().optional(),
            ingredientsTokens: z.array(z.string()).optional(),
            source: z.string(),
            sourceUrl: z.string(),
            externalId: z.string(),
            scrapedAt: z.string().nullable().optional(),
          }),
        ),
      },
      async ({ products }) => {
        const result = await this.scrapingService.pushProducts(products as any);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
            },
          ],
        };
      },
    );

    return server;
  }

  async handleRequest(req: Request, res: Response) {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (req.method === 'POST' && !sessionId) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          this.sessions.set(id, transport);
        },
      });

      transport.onclose = () => {
        const id = [...this.sessions.entries()].find(
          ([, t]) => t === transport,
        )?.[0];
        if (id) this.sessions.delete(id);
      };

      const server = this.createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionId) {
      const transport = this.sessions.get(sessionId);
      if (!transport) {
        res.status(400).json({ error: 'Invalid or expired session' });
        return;
      }
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({ error: 'Missing mcp-session-id header' });
  }
}
