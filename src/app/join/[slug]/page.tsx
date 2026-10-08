import { Join } from '@/features/card/join';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ auth?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const initialAccountMode =
    query.auth === 'sign-in' ? 'sign-in' : query.auth === 'recover' ? 'recover' : 'create';
  return <Join slug={slug} initialAccountMode={initialAccountMode} />;
}
