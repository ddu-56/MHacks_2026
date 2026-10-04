'use client';

import Link from 'next/link';
import { SquarePen, Globe, Mail, PhoneCall, History } from 'lucide-react';

export type TabId = 'advisor' | 'browser' | 'email' | 'phone' | 'activity';

interface OmniTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  activeCallCount?: number;
}

export function OmniTabs({ activeTab, onTabChange, activeCallCount = 0 }: OmniTabsProps) {
  const tabs = [
    { id: 'advisor' as TabId, label: 'New request', icon: SquarePen },
    { id: 'browser' as TabId, label: 'Web & Browser Agent', icon: Globe },
    { id: 'email' as TabId, label: 'Email & Tickets', icon: Mail },
    {
      id: 'phone' as TabId,
      label: 'Phone & Hold Queue',
      icon: PhoneCall,
      badge: activeCallCount > 0 ? `${activeCallCount} live` : undefined,
    },
    { id: 'activity' as TabId, label: 'Activity', icon: History },
  ];

  return (
    <aside
      aria-label="Omnichannel Navigation"
      className="shrink-0 bg-linear-to-b from-sunken to-transparent px-4 pt-4 md:sticky md:top-0 md:h-dvh md:w-64 md:bg-linear-to-r md:from-sunken md:via-sunken/60 md:px-3 md:pt-6"
    >
      <Link href="/" className="block px-3 pb-4 text-[1.35rem] font-semibold tracking-[-0.03em] text-ink md:pb-6">
        Hold<span className="text-ai">Less</span>
      </Link>
      <nav className="flex gap-1 overflow-x-auto pb-2 md:flex-col md:overflow-visible">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              title={tab.label}
              className={`flex shrink-0 items-center gap-3 rounded-full px-3 py-2.5 text-left text-[14.5px] transition ${
                isActive ? 'bg-ai-soft font-medium text-ink' : 'text-ink-2 hover:bg-line/60 hover:text-ink'
              }`}
            >
              <Icon className={`size-[18px] shrink-0 ${isActive ? 'text-ai' : 'text-muted'}`} />
              <span className="hidden whitespace-nowrap sm:inline">{tab.label}</span>
              {tab.badge && (
                <span className="ml-auto rounded-full bg-hold-soft px-2 py-0.5 text-[11px] font-medium text-hold">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
