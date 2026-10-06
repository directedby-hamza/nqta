'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  Users,
  ScanLine,
  Gift,
  Activity,
  Settings,
  ArrowUpRight,
  ChevronDown,
  Menu,
  LogOut,
  Sparkles,
  Store,
  Leaf,
} from 'lucide-react';
import { api, ApiError, initials, message } from '@/lib/api';
import type { Workspace } from '@/lib/types';
import { ErrorNotice, Loading, Modal, Reveal } from '@/components/ui/primitives';
const Context = createContext<{ workspace: Workspace; refresh: () => Promise<void> } | null>(null);
export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error('Workspace unavailable');
  return context;
}
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`logo ${light ? 'light' : ''}`} aria-label="Nqta home">
      <span className="logo-mark">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>
        nqta<span className="logo-period">.</span>
      </span>
    </Link>
  );
}
const links = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/cashier', label: 'Cashier', icon: ScanLine },
  { href: '/programme', label: 'Loyalty programme', icon: Gift },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
];
export function MerchantShell({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [mobile, setMobile] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  async function refresh() {
    try {
      setWorkspace(await api<Workspace>('workspace'));
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace('/sign-in');
      else setError(message(e));
    }
  }
  useEffect(() => {
    void refresh();
  }, []); // session scope is resolved by the server
  async function signOut() {
    await api('auth/sign-out', { method: 'POST', body: { kind: 'staff' } });
    router.replace('/sign-in');
  }
  const navigation = (
    <>
      <div className="nav-label eyebrow">Your workspace</div>
      <nav aria-label="Main navigation">
        {links
          .filter(
            (link) =>
              workspace?.actor.role === 'owner' || !['/settings', '/programme'].includes(link.href),
          )
          .map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${pathname === link.href ? 'active' : ''}`}
              onClick={() => setMobile(false)}
            >
              <link.icon size={18} strokeWidth={1.7} />
              <span>{link.label}</span>
              {pathname === link.href && <i className="nav-dot" />}
            </Link>
          ))}
      </nav>
    </>
  );
  if (!workspace)
    return (
      <div className="startup">
        <Logo />
        <Loading />
        <ErrorNotice error={error} />
      </div>
    );
  return (
    <Context.Provider value={{ workspace, refresh }}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <Logo />
          </div>
          <Link href="/settings" className="shop-context">
            <span className="shop-icon">
              <Store size={18} />
            </span>
            <span>
              <strong>{workspace.shop.name}</strong>
              <small>{workspace.shop.location}</small>
            </span>
            <ChevronDown size={13} />
          </Link>
          {navigation}
          <div className="sidebar-bottom">
            <div className="side-note">
              <span className="badge">
                <Leaf size={11} />
                {workspace.shop.subscription_status}
              </span>
              <h3>
                A little loyalty.
                <br />A lasting connection.
              </h3>
              <p>Your next regular starts with a simple hello.</p>
              <Link href={`/join/${workspace.shop.slug}`} target="_blank">
                Open customer page <ArrowUpRight size={13} />
              </Link>
            </div>
            <button className="profile-button" onClick={signOut}>
              <span className="avatar">{initials(workspace.actor.name || 'Owner')}</span>
              <span>
                <strong>{workspace.actor.name}</strong>
                <small>{workspace.actor.role === 'owner' ? 'Shop owner' : 'Cashier'}</small>
              </span>
              <LogOut size={15} />
            </button>
          </div>
        </aside>
        <div className="workspace-main">
          <header className="topbar">
            <div className="row">
              <button
                className="icon-button mobile-menu"
                aria-label="Open navigation"
                onClick={() => setMobile(true)}
              >
                <Menu size={19} />
              </button>
              <span className="breadcrumb">
                Workspace <span>/</span>{' '}
                <strong>{links.find((l) => l.href === pathname)?.label || 'Overview'}</strong>
              </span>
            </div>
            <div className="row">
              <span className={`badge ${workspace.shop.status === 'active' ? '' : 'warm'}`}>
                <i className="status-dot" />
                {workspace.shop.status === 'active' ? 'Programme active' : 'Programme paused'}
              </span>
              <span className="avatar top-avatar">{initials(workspace.actor.name || 'Owner')}</span>
            </div>
          </header>
          {(workspace.isDemo || workspace.hostedTest) && (
            <div className="demo-banner">
              <Sparkles size={13} />
              <span>
                {workspace.hostedTest
                  ? 'Hosted test · use sample data. Changes are shared across devices. SMS is simulated.'
                  : 'Local demo · synthetic customers. Changes are saved on this computer.'}
              </span>
              <Link href="/create-shop">
                Create your shop <ArrowUpRight size={12} />
              </Link>
            </div>
          )}
          <main className="workspace-content">
            <Reveal key={pathname}>{children}</Reveal>
            <footer className="workspace-footer">
              <span>Small gestures. Stronger connections.</span>
              <span>
                Made for your neighbourhood <Leaf size={11} />
              </span>
            </footer>
          </main>
        </div>
        <Modal
          open={mobile}
          onOpenChange={setMobile}
          title="Your workspace"
          description={workspace.shop.name}
        >
          {navigation}
          <div className="divider" />
          <button className="button secondary wide" onClick={signOut}>
            Sign out
          </button>
        </Modal>
      </div>
    </Context.Provider>
  );
}
