'use client';

import { useState } from 'react';
import { OmniTabs, type TabId } from '@/components/OmniTabs';
import { AdvisorHome } from '@/components/AdvisorHome';
import { BrowserAgentView } from '@/components/BrowserAgentView';
import { EmailTicketView } from '@/components/EmailTicketView';
import { NewCallForm } from '@/components/NewCallForm';
import { CallList } from '@/components/CallList';
import { StatusChips } from '@/components/Header';
import { WebSearch } from '@/components/WebSearch';
import Link from 'next/link';
import { motion } from 'motion/react';
import { useTable } from 'spacetimedb/react';
import { tables } from '@holdless/db';
import { isTerminal, type CallStatus } from '@holdless/shared';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('advisor');
  const [browserData, setBrowserData] = useState<Record<string, any> | undefined>();
  const [emailData, setEmailData] = useState<Record<string, any> | undefined>();
  const [phoneData, setPhoneData] = useState<Record<string, any> | undefined>();

  const [calls] = useTable(tables.callSession);
  const activeCallCount = calls.filter((c) => !isTerminal(c.status as CallStatus)).length;

  const handleSelectAction = (channel: TabId, prefill: Record<string, any>) => {
    if (channel === 'browser') {
      setBrowserData(prefill);
    } else if (channel === 'email') {
      setEmailData(prefill);
    } else if (channel === 'phone') {
      setPhoneData(prefill);
    }
    setActiveTab(channel);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <OmniTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeCallCount={activeCallCount}
      />

      <main className="relative flex min-w-0 flex-1 flex-col px-4 pb-20 sm:px-6 md:pl-32">
        <header className="flex flex-wrap items-center justify-between gap-3 py-4 md:-ml-26">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/" className="text-[1.35rem] font-semibold tracking-[-0.03em] text-ink">
              Hold<span className="text-ai">Less</span>
            </Link>
            <StatusChips />
          </div>
          <WebSearch />
        </header>
        <motion.div
          key={activeTab}
          className="flex flex-1 flex-col"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        >
        {activeTab === 'advisor' && (
          <AdvisorHome onSelectAction={handleSelectAction} />
        )}

        {activeTab === 'browser' && (
          <BrowserAgentView initialData={browserData} />
        )}

        {activeTab === 'email' && (
          <EmailTicketView initialData={emailData} />
        )}

        {activeTab === 'phone' && (
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-12">
            <div className="lg:sticky lg:top-6">
              <NewCallForm initialData={phoneData} />
            </div>
            <CallList />
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="max-w-4xl mx-auto">
            <CallList />
          </div>
        )}
        </motion.div>
      </main>
    </div>
  );
}
