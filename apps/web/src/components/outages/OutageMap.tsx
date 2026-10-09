import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useTranslation } from 'react-i18next';
import { formatTimeRange } from '../../lib/date.js';
import { resolveOutageMapPoint, outageCategory } from '../../lib/outage-location.js';
import type { Outage } from '@energy-monitor/shared';

// Fix leaflet default marker icon in bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface OutageMapProps {
  outages: Outage[];
}

export const OutageMap: React.FC<OutageMapProps> = ({ outages }) => {
  const { t } = useTranslation();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return <div className="h-96 w-full rounded-xl bg-muted animate-pulse" />;
  }

  // Center the map on the oblast, rather than the city of Chernihiv.
  const center: [number, number] = [51.5, 32.1];

  return (
    <div className="w-full bg-card p-3 rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="h-[400px] w-full rounded-lg overflow-hidden">
        <MapContainer
          center={center}
          zoom={8}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {outages.map((outage) => {
            const point = resolveOutageMapPoint(outage.areaName, outage.addressesRaw);
            const position: [number, number] = [point.lat, point.lng];

            return (
              <Marker key={outage.id} position={position}>
                <Popup>
                  <div className="p-1 space-y-1 text-xs">
                    <div className="font-bold text-sm text-foreground">{outage.areaName}</div>
                    <div className="text-[10px] text-muted-foreground">{point.label} · {outageCategory(outage.reason) === 'incident' ? 'Аварійні/ремонтні роботи' : 'Планові відключення'}</div>
                    <div className="text-muted-foreground">
                      {formatTimeRange(outage.startsAt, outage.endsAt)}
                    </div>
                    {outage.queue && (
                      <div className="inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-[10px] font-semibold">
                        Черга {outage.queue}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground line-clamp-3">
                      {outage.addressesNormalized || outage.addressesRaw}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
};