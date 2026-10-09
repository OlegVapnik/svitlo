import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X, ArrowRight } from 'lucide-react';
import type { Incident } from '@energy-monitor/shared';

interface IncidentBannerProps {
  incident: Incident;
}

export const IncidentBanner: React.FC<IncidentBannerProps> = ({ incident }) => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="bg-red-500 text-white p-3 sm:p-4 rounded-xl shadow-md flex items-start sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start sm:items-center gap-3">
        <div className="p-1.5 rounded-lg bg-white/20 shrink-0 mt-0.5 sm:mt-0">
          <AlertTriangle className="w-5 h-5 text-white" />
        </div>
        <div className="space-y-0.5">
          <div className="font-bold text-xs sm:text-sm tracking-wide uppercase">
            Увага: {incident.title}
          </div>
          <div className="text-xs text-white/90 line-clamp-1 sm:line-clamp-none">
            {incident.description}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/incidents"
          className="text-xs font-bold underline hover:text-white/80 whitespace-nowrap flex items-center gap-1"
        >
          <span>Деталі</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};