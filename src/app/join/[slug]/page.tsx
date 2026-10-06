import { Join } from '@/features/card/join';
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <Join slug={(await params).slug} />;
}
