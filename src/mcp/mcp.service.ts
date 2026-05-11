import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Brackets } from 'typeorm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { z } from 'zod';
import { ScrapingService } from '../scraping/scraping.service';
import { Product } from '../products/entities/product.entity';

@Injectable()
export class McpService implements OnModuleInit {
  private sessions = new Map<string, StreamableHTTPServerTransport>();

  constructor(
    private readonly scrapingService: ScrapingService,
    @InjectRepository(Product) private readonly productsRepo: Repository<Product>,
  ) {}

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

    server.tool(
      'get_products_missing_ingredients',
      'Fetches a batch of products from the Skinevora database that have missing or empty ingredients. Returns products with their id, name, brand, sourceUrl, and current ingredients status. Use this to find products that need ingredient enrichment, then use push_products to update them.',
      {
        batchSize: z.number().min(1).max(50).default(10).describe('Number of products to fetch per batch (1-50, default 10)'),
        offset: z.number().min(0).default(0).describe('Offset for pagination. Start at 0, increment by batchSize for next batch.'),
        filter: z.enum(['empty', 'no_tokens', 'partial', 'all']).default('empty').describe('Filter type: "empty" = no ingredients text, "no_tokens" = has text but not tokenized, "partial" = partially parsed, "all" = any issue'),
      },
      async ({ batchSize, offset, filter }) => {
        const qb = this.productsRepo.createQueryBuilder('p');

        if (filter === 'empty') {
          qb.where('(p.ingredients IS NULL OR p.ingredients = :empty)', { empty: '' });
        } else if (filter === 'no_tokens') {
          qb.where('p.ingredients IS NOT NULL')
            .andWhere('p.ingredients != :empty', { empty: '' })
            .andWhere('(p.ingredients_tokens IS NULL OR p.ingredient_breakdown IS NULL)');
        } else if (filter === 'partial') {
          qb.where('p.ingredient_breakdown IS NOT NULL')
            .andWhere('JSON_EXTRACT(p.ingredient_breakdown, "$.recognizedCount") < JSON_EXTRACT(p.ingredient_breakdown, "$.tokenCount")');
        } else {
          qb.where(new Brackets(sub => {
            sub.where('p.ingredients IS NULL')
              .orWhere('p.ingredients = :empty', { empty: '' })
              .orWhere('p.ingredients_tokens IS NULL')
              .orWhere('p.ingredient_breakdown IS NULL')
              .orWhere('JSON_EXTRACT(p.ingredient_breakdown, "$.recognizedCount") < JSON_EXTRACT(p.ingredient_breakdown, "$.tokenCount")');
          }));
        }

        const total = await qb.clone().getCount();
        const products = await qb
          .select([
            'p.id', 'p.name', 'p.brand', 'p.price', 'p.currency',
            'p.normalizedPriceInr', 'p.imageUrl', 'p.category', 'p.subcategory',
            'p.size', 'p.quantity', 'p.ingredients', 'p.ingredientsTokens',
            'p.platform', 'p.store', 'p.source', 'p.sourceUrl', 'p.externalId',
            'p.description',
          ])
          .orderBy('p.created_at', 'DESC')
          .skip(offset)
          .take(batchSize)
          .getMany();

        const result = {
          total,
          offset,
          batchSize,
          returned: products.length,
          hasMore: offset + products.length < total,
          nextOffset: offset + products.length,
          products: products.map(p => ({
            id: p.id,
            name: p.name,
            brand: p.brand,
            price: Number(p.price),
            currency: p.currency,
            normalizedPriceInr: Number(p.normalizedPriceInr),
            imageUrl: p.imageUrl,
            category: p.category,
            subcategory: p.subcategory,
            size: p.size,
            quantity: p.quantity,
            ingredients: p.ingredients,
            ingredientsTokens: p.ingredientsTokens,
            platform: p.platform,
            store: p.store,
            source: p.source,
            sourceUrl: p.sourceUrl,
            externalId: p.externalId,
            description: p.description,
          })),
        };

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
