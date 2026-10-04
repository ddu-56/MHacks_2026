'use client';

import { useState } from 'react';
import { OmniTabs, type TabId } from '@/components/OmniTabs';
import { AdvisorHome } from '@/components/AdvisorHome';
import { BrowserAgentView } from '@/components/BrowserAgentView';
import { EmailTicketView } from '@/components/EmailTicketView';
import { NewCallForm } from '@/components/NewCallForm';
import { CallList } from '@/components/CallList';
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
    <div className="flex flex-col">
      <OmniTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeCallCount={activeCallCount}
      />

      <div className="w-full">
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
      </div>
    </div>
  );
}
