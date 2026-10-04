import { CallView } from '@/components/CallView';
import { Header } from '@/components/Header';

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-[1240px] px-4 pb-20 sm:px-6">
        <CallView id={id} />
      </main>
    </>
  );
}
