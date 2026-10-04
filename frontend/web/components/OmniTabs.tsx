'use client';

import { Sparkles, Globe, Mail, PhoneCall, History } from 'lucide-react';

export type TabId = 'advisor' | 'browser' | 'email' | 'phone' | 'activity';

interface OmniTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  activeCallCount?: number;
}

export function OmniTabs({ activeTab, onTabChange, activeCallCount = 0 }: OmniTabsProps) {
  const tabs = [
    {
      id: 'advisor' as TabId,
      label: 'AI Advisor',
      icon: Sparkles,
      badge: 'Smart Triage',
      badgeTone: 'bg-ai-soft text-ai border-ai/20',
    },
    {
      id: 'browser' as TabId,
      label: 'Web & Browser Agent',
      icon: Globe,
      badge: 'Amazon / Portals',
      badgeTone: 'bg-sunken text-ink-2 border-line',
    },
    {
      id: 'email' as TabId,
      label: 'Email & Ticket Dispatch',
      icon: Mail,
      badge: 'Real Inbox',
      badgeTone: 'bg-human-soft text-human-strong border-human/20',
    },
    {
      id: 'phone' as TabId,
      label: 'Phone & Hold Queue',
      icon: PhoneCall,
      badge: activeCallCount > 0 ? `${activeCallCount} live` : undefined,
      badgeTone: 'bg-hold-soft text-hold border-hold/30',
    },
    {
      id: 'activity' as TabId,
      label: 'Activity History',
      icon: History,
    },
  ];

  return (
    <nav aria-label="Omnichannel Navigation" className="mb-8 w-full border-b border-line">
      <div className="flex flex-wrap items-center gap-2 pb-px sm:gap-3">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`group relative flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all sm:text-[14.5px] ${
                isActive
                  ? 'bg-surface text-ink shadow-sm ring-1 ring-line-strong'
                  : 'text-ink-2 hover:bg-surface/60 hover:text-ink'
              }`}
            >
              <Icon
                className={`size-4 transition-colors ${
                  isActive ? 'text-ai' : 'text-muted group-hover:text-ink'
                }`}
              />
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`hidden rounded-full border px-2 py-0.5 text-[11px] font-medium sm:inline-block ${
                    tab.badgeTone ?? 'bg-sunken text-muted border-line'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
              {isActive && (
                <span className="absolute -bottom-px left-3 right-3 h-[2px] rounded-full bg-ai" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
