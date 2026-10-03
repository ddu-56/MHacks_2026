import { CallView } from '@/components/CallView';

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CallView id={id} />;
}
