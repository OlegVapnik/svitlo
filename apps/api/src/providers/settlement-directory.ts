/**
 * Довідник населених пунктів за кодами КОАТУУ — згенерований з відкритого державного реєстру
 * (tools/gen_settlement_directory.py, файл у репозиторії, тож збір працює без мережі).
 *
 * Навіщо він оператору: «Чернігівобленерго» (і схожі веб-API) ідентифікують НП кодами КОАТУУ.
 * Без довідника перелік населених пунктів у .env тримали вручну, і в ньому було одне село
 * (Деснянське) — через що про аварійні відключення в інших 1500+ НП области застосунок
 * навіть не запитував, хоча оператор їх віддає (перевірено вживу: Мена — 208 записів,
 * Бахмач — 109).
 *
 * Файл — дані, а не логіка: він навмисно лежить у packages/api/src/providers/data і читається
 * як JSON, а не описується вручну (вигадані коди НП означали б вигадані відключення).
 */
import { createRequire } from 'node:module';
import path from 'node:path';

export interface DirectorySettlement {
  /** Код КОАТУУ — саме його оператор приймає в запиті. */
  koatuu: string;
  name: string;
  /** 'місто' | 'село' | 'селище' — з реєстру, не припущення. */
  kind: string;
  /** 1 — місто (обходимо першими), 2 — село/селище. */
  priority: 1 | 2;
  raion: string | null;
  hromada: string | null;
}

export interface DirectoryCityDistrict {
  koatuu: string;
  name: string;
  city: string | null;
}

export interface RegionDirectory {
  nameUa: string;
  settlements: DirectorySettlement[];
  cityDistricts: DirectoryCityDistrict[];
}

interface DirectoryFile {
  generatedAt: string | null;
  source: string | null;
  regions: Record<string, RegionDirectory>;
}

/**
 * cpu области приложения → код области в КОАТТГ.
 *
 * Экспортируется не «на всякий случай»: этим же списком пользуется
 * `tools/sync-directory-to-d1.mjs`, который переносит справочник в продовую D1. Второй,
 * отдельно написанный список рано или поздно разошёлся бы с этим — и облако перестало бы
 * находить НП, которые находит Node-бэкенд.
 */
export const REGION_KATOTTG: Record<string, string> = {
  'kyiv-city': 'UA80000000000093317',
  'vinnytska-oblast': 'UA05000000000010236',
  'volynska-oblast': 'UA07000000000024379',
  'dnipropetrovska-oblast': 'UA12000000000090473',
  'donetska-oblast': 'UA14000000000091971',
  'zhytomyrska-oblast': 'UA18000000000041385',
  'zakarpatska-oblast': 'UA21000000000011690',
  'zaporizka-oblast': 'UA23000000000064947',
  'ivano-frankivska-oblast': 'UA26000000000069363',
  'kyivska-oblast': 'UA32000000000030281',
  'kirovohradska-oblast': 'UA35000000000016081',
  'luhanska-oblast': 'UA44000000000018893',
  'lvivska-oblast': 'UA46000000000026241',
  'mykolaivska-oblast': 'UA48000000000039575',
  'odeska-oblast': 'UA51000000000030770',
  'poltavska-oblast': 'UA53000000000028050',
  'rivnenska-oblast': 'UA56000000000066151',
  'sumska-oblast': 'UA59000000000057109',
  'ternopilska-oblast': 'UA61000000000060328',
  'kharkivska-oblast': 'UA63000000000041885',
  'khersonska-oblast': 'UA65000000000030969',
  'khmelnytska-oblast': 'UA68000000000099709',
  'cherkaska-oblast': 'UA71000000000010357',
  'chernivetska-oblast': 'UA73000000000044923',
  'chernihivska-oblast': 'UA74000000000025378',
};

let cache: DirectoryFile | null = null;

function load(): DirectoryFile {
  if (cache) return cache;
  // require, бо JSON лежить поруч із TS-вихідним кодом: статичний import у 8-му tsconfig
  // не підхоплює .json без resolveJsonModule, а читати файл на кожному запиті некоректно.
  const require = createRequire(import.meta.url);
  const file = path.join(import.meta.dirname, 'data', 'settlement-directory.json');
  cache = require(file) as DirectoryFile;
  return cache;
}

/** Все НП области: города сначала, потом сёла — так обход укладывается в лимит запросов. */
export function settlementsForRegion(regionCpu: string): DirectorySettlement[] {
  const katottg = REGION_KATOTTG[regionCpu];
  if (!katottg) return [];
  return load().regions[katottg]?.settlements ?? [];
}

/** Районы города (Деснянский, Новозаводский и т.п.) — если оператор их отдаёт. */
export function cityDistrictsForRegion(regionCpu: string): DirectoryCityDistrict[] {
  const katottg = REGION_KATOTTG[regionCpu];
  if (!katottg) return [];
  return load().regions[katottg]?.cityDistricts ?? [];
}

/** Название области по справочнику (для логов и админ-вывода). */
export function regionDirectoryName(regionCpu: string): string | null {
  const katottg = REGION_KATOTTG[regionCpu];
  if (!katottg) return null;
  return load().regions[katottg]?.nameUa ?? null;
}

/** Сколько НП в справочнике по области — для /status и честного отчёта о покрытии. */
export function regionSettlementCount(regionCpu: string): number {
  return settlementsForRegion(regionCpu).length;
}
