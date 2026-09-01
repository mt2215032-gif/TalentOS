import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ui/theme';

export const metadata: Metadata = {
  title: {
    default: 'TalentOS — Practice interviews with an AI that thinks like a real interviewer',
    template: '%s · TalentOS',
  },
  description:
    'TalentOS runs adaptive AI interviews from your CV and a real job description, then returns an evidence-based evaluation with skill gaps and a plan to close them.',
  applicationName: 'TalentOS',
  openGraph: {
    title: 'TalentOS — AI Interview Practice',
    description:
      'Adaptive AI interviews that follow up on your answers, with structured evaluation and skill-gap analysis.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfd' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applied before first paint so a dark-mode user never sees a white
          flash. Inline by necessity: a deferred script runs too late.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('talentos-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
