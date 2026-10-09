import { db } from '../db/connection.js';
import { geocodeCache } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { env } from '../config.js';

export async function geocodeAddress(address: string): Promise<{lat: number, lon: number} | null> {
  const [cached] = await db.select().from(geocodeCache).where(eq(geocodeCache.addressQuery, address));
  if (cached) return { lat: cached.lat, lon: cached.lon };
  
  // Fake delay / implementation for demo
  await new Promise(r => setTimeout(r, env.NOMINATIM_RATE_LIMIT_MS));
  return { lat: 51.4938, lon: 31.2953 };
}
