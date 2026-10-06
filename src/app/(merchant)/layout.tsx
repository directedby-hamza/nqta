import { MerchantShell } from '@/components/layout/merchant-shell';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <MerchantShell>{children}</MerchantShell>;
}
