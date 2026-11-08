/**
 * `@svitlo/domain` — чистий домен Svitlo (ADR-0003).
 *
 * Правила пакета:
 * - нуль runtime-залежностей: тільки стандартна бібліотека (типи `Date`, `Intl`, масиви);
 * - ніякого I/O: ні `fetch`, ні D1, ні R2, ні `process.env`;
 * - ніяких UI/рантайм-типів (React, Workers, Node) — тому `tsconfig` пакета тримає `types: []`;
 * - відносні імпорти — з розширенням `.ts`, бо пакет виконується Node'ом як TS-джерело
 *   (type stripping не резолвить `./x.js` → `x.ts`).
 *
 * Модулі додаються по одному в межах шагу 2 міграції (`docs/ARCHITECTURE.md` §11):
 * регіони → інтервали → публікація → адреса → надійність.
 */

export * from './kyiv-time.ts';
export * from './kyiv-day.ts';
export * from './schedule-utils.ts';
export * from './queue.ts';
export * from './daily-intervals.ts';
export * from './schedule-diff.ts';
export * from './schedule-date.ts';
export * from './address.ts';
export * from './publication.ts';
export * from './reliability.ts';
export * from './region-sources.ts';
export * from './address-pack.ts';
export * from './grid-regime.ts';
