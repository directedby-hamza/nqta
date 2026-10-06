import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ScanLine,
  Coffee,
  Leaf,
  Smartphone,
  Users,
  Sparkles,
} from 'lucide-react';
import { Logo } from '@/components/layout/merchant-shell';
import { Reveal } from '@/components/ui/primitives';
export default function Home() {
  return (
    <div className="landing">
      <header className="public-header">
        <Logo />
        <nav aria-label="Public navigation">
          <a href="#how-it-works">How it works</a>
          <Link href="/sign-in">Sign in</Link>
          <Link href="/create-shop" className="button primary">
            Start your story <ArrowUpRight size={15} />
          </Link>
        </nav>
      </header>
      <main>
        <section className="hero">
          <Reveal className="hero-copy">
            <span className="hero-kicker">
              <i /> A little loyalty goes a long way
            </span>
            <h1>
              Turn a visit
              <br />
              into a <em>habit.</em>
            </h1>
            <p>
              Your neighbourhood deserves more than a paper card.
              <br />
              Meet the simple way to reward regulars, remember people,
              <br className="desktop-break" /> and give them a reason to come back.
            </p>
            <div className="hero-actions">
              <Link href="/sign-in" className="button primary">
                Explore the demo <ArrowUpRight size={16} />
              </Link>
              <Link href="/create-shop" className="button secondary">
                Create your shop <ArrowRight size={16} />
              </Link>
            </div>
            <div className="hero-foot">
              <span>
                <Check size={13} /> No app to download
              </span>
              <span>
                <Check size={13} /> Built for small shops
              </span>
            </div>
          </Reveal>
          <Reveal className="hero-visual" delay={0.15}>
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="floating-label label-top">
              <span className="metric-icon">
                <Users size={17} />
              </span>
              <span>
                Familiar faces.
                <br />
                <strong>Lasting connections.</strong>
              </span>
            </div>
            <div className="sample-card">
              <div className="between">
                <span className="sample-wordmark">
                  morrow<span>coffee & good company</span>
                </span>
                <Coffee size={27} strokeWidth={1.3} />
              </div>
              <div className="sample-card-title">
                Your daily ritual.
                <br />
                Our little thank you.
              </div>
              <div className="sample-stamps">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className={i < 4 ? 'filled' : ''}>
                    {i < 4 ? <Check size={22} /> : <Coffee size={20} />}
                  </span>
                ))}
              </div>
              <div className="between">
                <span>4 of 5 stamps collected</span>
                <span className="sample-star">✦</span>
              </div>
              <div className="sample-card-bottom">
                One more coffee.
                <br />
                <strong>The next one’s on us.</strong>
              </div>
            </div>
            <div className="floating-label label-bottom">
              <span className="celebrate-icon">
                <GiftIcon />
              </span>
              <span>
                A little treat.
                <br />
                <strong>A big reason to return.</strong>
              </span>
              <Sparkles size={17} />
            </div>
            <span className="visual-caption">An example card · your brand, your rewards</span>
          </Reveal>
        </section>
        <div className="business-strip">
          <span>
            Made for the places
            <br />
            <strong>we keep coming back to.</strong>
          </span>
          <span>Cafés & bakeries</span>
          <span>Beauty & wellness</span>
          <span>Neighbourhood retail</span>
          <span>Services & more</span>
        </div>
        <section className="how-section" id="how-it-works">
          <div className="eyebrow">Less paper. More people.</div>
          <h2>
            A good habit starts
            <br />
            with something simple<span className="accent-period">.</span>
          </h2>
          <div className="how-grid">
            {[
              {
                number: '01',
                icon: ScanLine,
                title: 'One scan. They’re in.',
                text: 'A customer scans your shop QR, verifies their phone, and gets a digital loyalty card in their browser.',
              },
              {
                number: '02',
                icon: Smartphone,
                title: 'Every visit counts.',
                text: 'Your team records a qualifying paid receipt. Their stamp appears on the card, safely saved for next time.',
              },
              {
                number: '03',
                icon: Coffee,
                title: 'A reason to come back.',
                text: 'When the card is full, a reward is ready. Staff redeem it with the customer’s short-lived confirmation code.',
              },
            ].map((step) => (
              <Reveal key={step.number} className="how-card">
                <div className="between">
                  <step.icon size={25} strokeWidth={1.4} />
                  <span>{step.number}</span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </Reveal>
            ))}
          </div>
          <div className="landing-cta">
            <div>
              <Leaf size={24} />
              <h3>
                Start with your shop.
                <br />
                Grow with your people.
              </h3>
            </div>
            <Link href="/create-shop" className="button primary">
              Create your workspace <ArrowUpRight size={16} />
            </Link>
          </div>
        </section>
      </main>
      <footer className="public-footer">
        <Logo />
        <span>Small gestures. Stronger connections.</span>
        <Link href="/sign-in">
          Merchant sign in <ArrowUpRight size={13} />
        </Link>
      </footer>
    </div>
  );
}
function GiftIcon() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M4 11h16v10H4zM3 7h18v4H3zM12 7v14" />
      <path d="M12 7C5 7 5 1 9 3l3 4Zm0 0c7 0 7-6 3-4l-3 4Z" />
    </svg>
  );
}
