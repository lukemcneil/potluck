import { AppBar } from "@/components/nav/AppBar";
import { BottomTabBar } from "@/components/nav/BottomTabBar";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppBar />
      <main className="flex-1 pb-24 md:pb-10">{children}</main>
      <BottomTabBar />
    </div>
  );
}
