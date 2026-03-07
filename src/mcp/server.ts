/**
 * IdleX MCP Server — 让外部 AI Agent 能发现和查询门店数据
 *
 * 暴露 3 个 tools:
 *   - search_stores:     按城市/商圈/品类搜索门店
 *   - get_store_detail:  获取门店完整档案（含 JSON-LD）
 *   - check_availability: 查询可用时段和房型
 *
 * 运行方式: node --import tsx packages/bps-engine/src/mcp/server.ts
 * 或通过 MCP 客户端配置 stdio transport
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createBpsEngine } from '../index.js';
import { createDatabase } from '../store/db.js';
import type { DossierStore, DossierSearchResult } from '../store/dossier-store.js';
import path from 'path';
import { homedir } from 'os';

// ——— JSON-LD Serialization ———

function storeDataToJsonLd(entityId: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'EntertainmentBusiness'],
    '@id': `idlex:store:${entityId}`,
    'name': data.storeName,
    'address': {
      '@type': 'PostalAddress',
      'streetAddress': data.address,
      'addressLocality': data.city,
      'addressRegion': data.district,
    },
    'geo': {
      '@type': 'GeoCoordinates',
      'latitude': data.lat,
      'longitude': data.lng,
    },
    'openingHours': data.operatingHours,
    'telephone': data.contactPhone,
    'description': data.features,
    'areaServed': data.businessCircle,
    'additionalProperty': [
      ...(Array.isArray(data.roomTypes) ? (data.roomTypes as Array<Record<string, unknown>>).map(rt => ({
        '@type': 'PropertyValue',
        'name': `room_${rt.type}`,
        'value': JSON.stringify({
          type: rt.type,
          capacity: rt.capacity,
          count: rt.count,
          priceWeekday: rt.priceWeekday,
          priceWeekend: rt.priceWeekend,
        }),
      })) : []),
      {
        '@type': 'PropertyValue',
        'name': 'equipment',
        'value': JSON.stringify(data.equipment),
      },
      {
        '@type': 'PropertyValue',
        'name': 'saasSystem',
        'value': data.saasSystem,
      },
    ],
  };
}

// ——— Tool Implementations ———

function searchStores(
  dossierStore: DossierStore,
  params: { city?: string; district?: string; businessCircle?: string; keyword?: string },
): Array<Record<string, unknown>> {
  const results = dossierStore.search({ entityType: 'store', lifecycle: 'ACTIVE' });

  return results
    .filter(r => {
      const d = r.data as Record<string, unknown>;
      if (params.city && d.city !== params.city) return false;
      if (params.district && d.district !== params.district) return false;
      if (params.businessCircle && d.businessCircle !== params.businessCircle) return false;
      if (params.keyword) {
        const kw = params.keyword.toLowerCase();
        const text = [d.storeName, d.features, d.address, d.businessCircle]
          .filter(Boolean).join(' ').toLowerCase();
        if (!text.includes(kw)) return false;
      }
      return true;
    })
    .map(r => {
      const d = r.data as Record<string, unknown>;
      return {
        storeId: r.dossier.entityId,
        storeName: d.storeName,
        city: d.city,
        district: d.district,
        businessCircle: d.businessCircle,
        address: d.address,
        operatingHours: d.operatingHours,
        features: d.features,
        roomTypes: Array.isArray(d.roomTypes)
          ? (d.roomTypes as Array<Record<string, unknown>>).map(rt => ({
              type: rt.type,
              capacity: rt.capacity,
              priceWeekday: rt.priceWeekday,
              priceWeekend: rt.priceWeekend,
            }))
          : [],
      };
    });
}

function getStoreDetail(
  dossierStore: DossierStore,
  storeId: string,
): Record<string, unknown> | null {
  const result = dossierStore.get('store', storeId);
  if (!result) return null;

  const data = result.data as Record<string, unknown>;
  return {
    storeId,
    storeName: data.storeName,
    raw: data,
    jsonLd: storeDataToJsonLd(storeId, data),
    dossier: {
      id: result.dossier.id,
      version: result.dossier.currentVersion,
      lifecycle: result.dossier.lifecycle,
      updatedAt: result.dossier.updatedAt,
    },
  };
}

function checkAvailability(
  dossierStore: DossierStore,
  storeId: string,
  roomType?: string,
): Record<string, unknown> | null {
  const result = dossierStore.get('store', storeId);
  if (!result) return null;

  const data = result.data as Record<string, unknown>;
  const rooms = (Array.isArray(data.roomTypes) ? data.roomTypes : []) as Array<Record<string, unknown>>;

  const filtered = roomType
    ? rooms.filter(rt => rt.type === roomType)
    : rooms;

  return {
    storeId,
    storeName: data.storeName,
    operatingHours: data.operatingHours,
    rooms: filtered.map(rt => ({
      type: rt.type,
      capacity: rt.capacity,
      totalCount: rt.count,
      priceWeekday: rt.priceWeekday,
      priceWeekend: rt.priceWeekend,
    })),
    lastUpdated: result.dossier.updatedAt,
    note: 'Real-time availability requires SaaS system integration (not yet implemented). Showing static room inventory.',
  };
}

// ——— MCP Server Setup ———

export function createIdlexMcpServer(dbPath: string) {
  const db = createDatabase(dbPath);
  const engine = createBpsEngine({ db });

  const server = new McpServer({
    name: 'idlex-stores',
    version: '1.0.0',
  });

  server.tool(
    'search_stores',
    'Search IdleX partner stores by city, district, business circle, or keyword. Returns a list of stores with basic info and pricing.',
    {
      city: z.string().optional().describe('City name (e.g., "长沙")'),
      district: z.string().optional().describe('District name (e.g., "天心区")'),
      businessCircle: z.string().optional().describe('Business circle name (e.g., "五一广场")'),
      keyword: z.string().optional().describe('Keyword search in store name, features, address'),
    },
    async (params) => {
      const stores = searchStores(engine.dossierStore, params);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: stores.length,
            stores,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'get_store_detail',
    'Get complete store profile including JSON-LD structured data (Schema.org LocalBusiness), room types, equipment, and pricing. Use this when a user wants detailed information about a specific store.',
    {
      storeId: z.string().describe('Store entity ID (e.g., "store-ktv-changsha-001")'),
    },
    async ({ storeId }) => {
      const detail = getStoreDetail(engine.dossierStore, storeId);
      if (!detail) {
        return {
          content: [{ type: 'text' as const, text: `Store not found: ${storeId}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(detail, null, 2) }],
      };
    },
  );

  server.tool(
    'check_availability',
    'Check room availability and pricing for a store. Optionally filter by room type (小包/中包/大包/VIP包). Use this when a user wants to book or check prices.',
    {
      storeId: z.string().describe('Store entity ID'),
      roomType: z.string().optional().describe('Room type filter: 小包, 中包, 大包, VIP包'),
    },
    async ({ storeId, roomType }) => {
      const availability = checkAvailability(engine.dossierStore, storeId, roomType);
      if (!availability) {
        return {
          content: [{ type: 'text' as const, text: `Store not found: ${storeId}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(availability, null, 2) }],
      };
    },
  );

  return { server, engine };
}

// ——— Standalone Entry Point ———

export async function startMcpServer(dbPath?: string) {
  const resolvedDbPath = dbPath
    ?? process.env.BPS_DB_PATH
    ?? path.join(homedir(), '.aida', 'data', 'bps.db');

  const { server } = createIdlexMcpServer(resolvedDbPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run directly if this is the entry point
const isDirectRun = process.argv[1]?.endsWith('mcp/server.ts')
  || process.argv[1]?.endsWith('mcp/server.js');
if (isDirectRun) {
  startMcpServer().catch(err => {
    console.error('MCP Server failed to start:', err);
    process.exit(1);
  });
}
