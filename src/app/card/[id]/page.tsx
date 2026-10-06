import { CustomerCard } from '@/features/card/card';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CustomerCard id={(await params).id} />;
}
