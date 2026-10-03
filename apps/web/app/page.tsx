import { CallList } from '@/components/CallList';
import { NewCallForm } from '@/components/NewCallForm';

export default function Home() {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-12">
      <div className="lg:sticky lg:top-6">
        <NewCallForm />
      </div>
      <CallList />
    </div>
  );
}
