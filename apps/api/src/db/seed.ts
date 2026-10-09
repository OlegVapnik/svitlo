import { db } from './connection.js';
import { sources, contacts, gridStatus, outages, incidents } from './schema.js';
import { contentHash } from '../utils/hash.js';

async function seed() {
  console.log('Seeding data...');
  
  // Sources
  const [source] = await db.insert(sources).values({
    name: 'Interruptions Energy CN UA',
    url: 'https://interruptions.energy.cn.ua',
    type: 'html'
  }).returning();
  if (!source) throw new Error('Failed to create seed source');

  // Contacts
  await db.insert(contacts).values([
    { type: 'phone', label: 'Call-center', value: '0 800 210-310', region: 'Chernihiv Oblast' },
    { type: 'phone', label: 'Call-center', value: '0 462 772-901', region: 'Chernihiv Oblast' },
    { type: 'telegram', label: 'Telegram Channel', value: '@chernigivoblenergo', region: 'Chernihiv Oblast' },
    { type: 'telegram', label: 'Telegram Bot', value: '@ChernigivOEbot', region: 'Chernihiv Oblast' }
  ]);

  // Grid Status
  await db.insert(gridStatus).values({
    sourceId: source.id,
    level: 'stable',
    message: 'System is stable, scheduled maintenance running.'
  });

  // Outages
  const now = new Date();
  const tmr = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  const rawAddresses = 'вул. Шевченка, буд. 1, 3, 5';
  await db.insert(outages).values({
    sourceId: source.id,
    startsAt: now,
    endsAt: tmr,
    areaName: 'Чернігів',
    addressesRaw: rawAddresses,
    addressesNormalized: 'вул Шевченка 1 3 5',
    reason: 'Planned maintenance',
    queue: 1,
    status: 'active',
    contentHash: contentHash(`Chernihivoblenergo-Чернігів-${rawAddresses}-${now.toISOString()}-${tmr.toISOString()}`)
  });

  // Incidents
  await db.insert(incidents).values({
    sourceId: source.id,
    title: 'Emergency outage in Nizhyn',
    description: 'Bad weather caused power lines to fail.',
    startedAt: now,
    severity: 'high',
    status: 'active'
  });

  console.log('Seed completed successfully!');
  process.exit(0);
}

seed().catch(console.error);
