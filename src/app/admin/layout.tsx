import type { Metadata } from 'next';
import '@/features/admin/admin.css';
export const metadata: Metadata = {
  title: 'Nqta administration',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
