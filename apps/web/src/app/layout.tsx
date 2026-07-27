import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/lib/theme-context';
import { I18nProvider } from '@/lib/i18n-context';
import { AuthProvider } from '@/lib/auth-context';
import { SocketProvider } from '@/lib/socket-context';
import { NotificationsProvider } from '@/lib/notifications-context';
import { ToastProvider } from '@/components/ui/toast';
import { AppChrome } from '@/components/layout/app-chrome';
import { SiteNameProvider } from '@/lib/site-name-context';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AD-Wiki',
  description: 'Open Source Knowledge Base',
};

/**
 * Setzt vor dem ersten Paint die richtige Theme-Klasse am <html>, damit im
 * Dark-Mode nichts „aufblitzt" (FOUC). Bewusst ohne Abhängigkeiten und synchron.
 */
const themeInitScript = `(function(){try{var m=localStorage.getItem('ad-wiki-theme')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;c.remove('light','dark');c.add(d?'dark':'light');document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.className} min-h-screen bg-background text-foreground antialiased`}>
        <ThemeProvider>
          <I18nProvider>
            <SiteNameProvider>
              <AuthProvider>
                <ToastProvider>
                  <SocketProvider>
                    <NotificationsProvider>
                      <AppChrome>{children}</AppChrome>
                    </NotificationsProvider>
                  </SocketProvider>
                </ToastProvider>
              </AuthProvider>
            </SiteNameProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
