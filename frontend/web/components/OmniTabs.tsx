'use client';

import { useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react';
import { SquarePen, Globe, Mail, PhoneCall, History, type LucideIcon } from 'lucide-react';

export type TabId = 'advisor' | 'browser' | 'email' | 'phone' | 'activity';

interface OmniTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  activeCallCount?: number;
}

// Vertical dock (md+): icons magnify as the cursor approaches along Y; labels pop out to the right.
const BASE = 44;
const MAGNIFIED = 64;
const DISTANCE = 140;
const SPRING = { mass: 0.1, stiffness: 150, damping: 12 };

interface Tab {
  id: TabId;
  label: string;
  icon: LucideIcon;
  live?: boolean;
}

function DockItem({
  tab,
  isActive,
  mouseY,
  activeCallCount,
  onClick,
}: {
  tab: Tab;
  isActive: boolean;
  mouseY: MotionValue<number>;
  activeCallCount: number;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);

  const dist = useTransform(mouseY, (y) => {
    const rect = ref.current?.getBoundingClientRect() ?? { y: 0, height: BASE };
    return y - rect.y - rect.height / 2;
  });
  const size = useSpring(useTransform(dist, [-DISTANCE, 0, DISTANCE], [BASE, MAGNIFIED, BASE]), SPRING);
  const Icon = tab.icon;

  return (
    <motion.button
      ref={ref}
      type="button"
      style={{ width: size, height: size }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      aria-label={tab.label}
      className={`relative grid shrink-0 place-items-center rounded-full border shadow-card transition-colors ${
        isActive ? 'border-ai/40 bg-ai-soft text-ai' : 'border-line bg-surface text-muted hover:text-ink'
      }`}
    >
      <Icon className="size-[45%]" />
      {tab.live && (
        <span className="absolute right-0.5 top-0.5 size-2.5 rounded-full border-2 border-surface bg-hold breathe" aria-hidden />
      )}
      <AnimatePresence>
        {hovered && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, x: 0 }}
            animate={{ opacity: 1, x: 10 }}
            exit={{ opacity: 0, x: 0 }}
            transition={{ duration: 0.2 }}
            style={{ y: '-50%' }}
            className="pointer-events-none absolute left-full top-1/2 hidden whitespace-nowrap rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink shadow-card md:block"
          >
            {tab.label}
            {tab.live && <span className="ml-1.5 font-medium text-hold">{activeCallCount} live</span>}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export function OmniTabs({ activeTab, onTabChange, activeCallCount = 0 }: OmniTabsProps) {
  const tabs: Tab[] = [
    { id: 'advisor', label: 'New request', icon: SquarePen },
    { id: 'browser', label: 'Web & Browser Agent', icon: Globe },
    { id: 'email', label: 'Email & Tickets', icon: Mail },
    { id: 'phone', label: 'Phone & Hold Queue', icon: PhoneCall, live: activeCallCount > 0 },
    { id: 'activity', label: 'Activity', icon: History },
  ];
  const mouseY = useMotionValue(Infinity);

  return (
    <nav
      onMouseMove={(e) => mouseY.set(e.clientY)}
      onMouseLeave={() => mouseY.set(Infinity)}
      aria-label="Omnichannel Navigation"
      className="flex items-center gap-2 overflow-x-auto border-b border-line bg-sunken px-4 py-2 md:fixed md:left-3 md:top-1/2 md:z-30 md:w-[72px] md:-translate-y-1/2 md:flex-col md:items-start md:gap-3 md:overflow-visible md:rounded-2xl md:border md:bg-sunken/90 md:p-3 md:backdrop-blur"
    >
      {tabs.map((tab) => (
        <DockItem
          key={tab.id}
          tab={tab}
          isActive={activeTab === tab.id}
          mouseY={mouseY}
          activeCallCount={activeCallCount}
          onClick={() => onTabChange(tab.id)}
        />
      ))}
    </nav>
  );
}
