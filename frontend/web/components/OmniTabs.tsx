'use client';

import { useState, type CSSProperties } from 'react';
import { SquarePen, Globe, Mail, PhoneCall, History } from 'lucide-react';

export type TabId = 'advisor' | 'browser' | 'email' | 'phone' | 'activity';

interface OmniTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  activeCallCount?: number;
}

// Arc geometry (md+): icons sit on a circle whose hub is just off the left edge;
// on hover the disc grows and labels unfurl along the radius inside it.
const RADIUS = 90;
const HUB_X = -10;
const HUB_Y = 140;
const SPREAD_DEG = 120;
const PAD = 28; // disc edge beyond the icons when closed
const LABEL_ROOM = 190; // extra disc radius when open, sized for the longest label

export function OmniTabs({ activeTab, onTabChange, activeCallCount = 0 }: OmniTabsProps) {
  const tabs = [
    { id: 'advisor' as TabId, label: 'New request', icon: SquarePen },
    { id: 'browser' as TabId, label: 'Web & Browser Agent', icon: Globe },
    { id: 'email' as TabId, label: 'Email & Tickets', icon: Mail },
    { id: 'phone' as TabId, label: 'Phone & Hold Queue', icon: PhoneCall, live: activeCallCount > 0 },
    { id: 'activity' as TabId, label: 'Activity', icon: History },
  ];
  const [open, setOpen] = useState(false);
  const discR = RADIUS + PAD + (open ? LABEL_ROOM : 0);

  return (
    <nav
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      aria-label="Omnichannel Navigation"
      className="flex gap-1 overflow-x-auto border-b border-line bg-sunken px-4 py-2 md:fixed md:left-0 md:top-1/2 md:z-30 md:h-[280px] md:w-24 md:-translate-y-1/2 md:overflow-visible md:border-0 md:bg-transparent md:p-0"
    >
      {/* Half-disc backdrop behind the arc */}
      <div
        aria-hidden
        className="absolute hidden rounded-full border border-line bg-sunken/90 shadow-card backdrop-blur transition-all duration-300 ease-out md:block"
        style={{ width: 2 * discR, height: 2 * discR, left: HUB_X - discR, top: HUB_Y - discR }}
      />
      {tabs.map((tab, i) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const deg = -SPREAD_DEG / 2 + (SPREAD_DEG / (tabs.length - 1)) * i;
        const rad = (deg * Math.PI) / 180;
        const style = {
          '--x': `${HUB_X + RADIUS * Math.cos(rad) - 20}px`,
          '--y': `${HUB_Y + RADIUS * Math.sin(rad) - 20}px`,
          '--rot': `${deg}deg`,
        } as CSSProperties;
        return (
          <button
            key={tab.id}
            type="button"
            style={style}
            onClick={() => onTabChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            aria-label={tab.label}
            className="group/item relative flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[14px] md:absolute md:left-(--x) md:top-(--y) md:p-0"
          >
            <span
              className={`relative grid size-10 shrink-0 place-items-center rounded-full border transition ${
                isActive
                  ? 'border-ai/40 bg-ai-soft text-ai shadow-card'
                  : 'border-line bg-surface text-muted group-hover/item:text-ink'
              }`}
            >
              <Icon className="size-[18px]" />
              {tab.live && (
                <span className="absolute right-0.5 top-0.5 size-2.5 rounded-full border-2 border-surface bg-hold breathe" aria-hidden />
              )}
            </span>
            {/* Pivot at the icon's center, rotated onto its spoke, so the label lines up radially */}
            <span className="md:absolute md:left-1/2 md:top-1/2 md:size-0 md:rotate-(--rot)">
              <span
                className={`block whitespace-nowrap transition duration-300 md:absolute md:left-7 md:top-0 md:-translate-y-1/2 md:origin-left ${
                  open ? 'md:scale-100 md:opacity-100' : 'md:pointer-events-none md:scale-50 md:opacity-0'
                } ${isActive ? 'font-medium text-ink' : 'text-ink-2 group-hover/item:text-ink'}`}
                style={{ transitionDelay: `${i * 40}ms` }}
              >
                {tab.label}
                {tab.live && <span className="ml-1.5 text-[11px] font-medium text-hold">{activeCallCount} live</span>}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
