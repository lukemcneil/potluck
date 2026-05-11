import { AppBar } from "@/components/nav/AppBar";
import { BottomTabBar } from "@/components/nav/BottomTabBar";
import {
  InstallPromptBanner,
  InstallPromptProvider,
} from "@/components/pwa/InstallPrompt";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <InstallPromptProvider>
      <div className="flex min-h-dvh flex-col">
        {/*
          WCAG 2.4.1 — let keyboard users jump past the AppBar / bottom
          tab bar. The link is visually hidden until focused, then pops
          a high-contrast pill at the top-left.
        */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Skip to content
        </a>
        <AppBar />
        <main id="main-content" className="flex-1 pb-24 md:pb-10">
          {children}
        </main>
        <BottomTabBar />
        <InstallPromptBanner />
      </div>
    </InstallPromptProvider>
  );
}
