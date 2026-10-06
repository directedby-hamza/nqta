import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Nqta — Every visit counts', template: '%s · Nqta' },
  description:
    'Thoughtful digital loyalty for the shops you love. Reward regulars, understand visits, and make the next visit count.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
