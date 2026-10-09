---
name: api-endpoint-change
description: "Checklist and conventions for adding or changing an HTTP endpoint in the EnergyMonitor Fastify API and wiring it through to the React app: shared zod types, route, service, error envelope, auth, pagination, caching, tests, web client and TanStack hook. Use for any new route, changed response shape, new query parameter, admin endpoint, or when fixing endpoint contracts (fake pagination, ignored params, %2F queue ids). Триггеры: эндпоинт, ручка, роут, /api/v1, параметр запроса, пагинация, ответ API, admin route."
---

# API endpoint change

Order matters: **shared types → route → service → test → web client → web hook → UI**.
Mirror an existing route file (e.g. `routes/contacts.ts` for a simple GET, `routes/admin.ts` for an authenticated one) instead of inventing a new style: read it first.

## Conventions (this repo)

- Prefix `/api/v1`. Success: `{ "data": … }`, lists add `meta: { page, limit, total, totalPages }`.
  Error: `{ "error": { "code", "message", "details"? } }`, thrown as `AppError(statusCode, 'CODE', 'message')`; `ZodError` becomes 400 `VALIDATION_ERROR` in the global handler.
- Input validated with zod schemas that live in `packages/shared/src/index.ts` and are reused by the web app for types.
- Handlers stay thin: parse → call service → wrap in `{ data }`. SQL and business rules live in `src/services/`.
- Admin routes use the `fastify.authenticate` decorator (Bearer `ADMIN_TOKEN`).
- Relative imports use `.js` extensions. Config comes from `config.ts` only (never read `process.env` elsewhere).
- Register new route files in `server.ts`.

## Checklist

1. **Contract in one sentence**: method, path, params, response, who may call it, expected size, cache TTL.
2. **Shared**: add/adjust the zod schema and the TS type in `packages/shared/src/index.ts`.
3. **Route** (`src/routes/<name>.ts`): `export default async function xRoutes(fastify)`; validate with the shared schema; throw `AppError` for 404/409/…
4. **Service** (`src/services/<name>.service.ts`): pure function(s) taking explicit inputs (`now`, filters), no hidden clock.
5. **Pagination**: real `LIMIT/OFFSET` (or cursor) in SQL, `total` from `count(*) over ()` or a matching count. Never "fetch 1000 then slice".
6. **Parameters**: every documented query parameter must be honoured or removed from the schema (`/outages/stats` currently ignores its arguments — do not copy that).
7. **Identifiers**: do not put `/` in path/query identifiers (queue `2/2` forced a `%2F` workaround). Use `2-2` or `2.2` for new code.
8. **Caching**: data changes every ~30 min. Read endpoints may send `Cache-Control: public, max-age=30` (or ETag); `no-store` only for search suggestions and admin.
9. **Security**: reads are public, writes require Bearer. Never log the token or request bodies of admin routes. Keep the rate limit in mind (100/min/IP; behind nginx `trustProxy` must be on).
10. **Tests** (`apps/api/tests/routes/<name>.test.ts`): happy path, validation error 400, 404, auth 401/403 for admin, pagination edges. Use `fastify.inject`.
11. **Web client**: add a method in `apps/web/src/api/client.ts` (the only place that calls `fetch`), then a hook in `api/queries.ts` with a stable `queryKey` and a sensible `staleTime` (30–60 s for outage data).
12. **Docs**: update the endpoint table in `PROJECT_MAP.md` §5 in the same change.
13. **Verify**: `bash skills/energymon-onboarding/scripts/verify.sh`, then `curl` the endpoint and paste the output.

## Skeleton (shape only — copy the real style from a neighbouring route)

```ts
import type { FastifyInstance } from 'fastify';
import { itemQuerySchema } from '@energy-monitor/shared';
import { AppError } from '../utils/errors.js';
import { listItems } from '../services/item.service.js';

export default async function itemRoutes(fastify: FastifyInstance) {
  fastify.get('/items', async (request) => {
    const query = itemQuerySchema.parse(request.query);          // ZodError → 400 handled globally
    const { rows, total } = await listItems(query, new Date());
    return { data: rows, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  });

  fastify.get('/items/:id', async (request) => {
    const { id } = request.params as { id: string };
    const item = await getItem(id);
    if (!item) throw new AppError(404, 'NOT_FOUND', 'Item not found');
    return { data: item };
  });
}
```

## Common mistakes

- Changing a response shape without updating `packages/shared` and the web hook → runtime `undefined` in the UI.
- Reading `process.env` in a service → untestable and bypasses the zod config.
- Adding `mergeDuplicateOutages` to a new endpoint (see `outage-data-core`).
- Returning raw DB rows (snake_case, internal columns) instead of the shared type.
- Forgetting the web client path for admin pages: tokens must never be stored in `localStorage`.
