import { CustomerCard } from '@/features/card/card';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ shop?: string | string[] }>;
}) {
  const shop = (await searchParams).shop;
  return (
    <CustomerCard id={(await params).id} shopSlug={typeof shop === 'string' ? shop : undefined} />
  );
}
