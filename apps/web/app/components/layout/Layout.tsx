import { useCallback, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { Footer } from "./Footer";
import { AdminWorkspace } from "../admin/AdminWorkspace";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const isAdminWorkspace =
    location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  const closeMobileSidebar = useCallback(() => setIsMobileSidebarOpen(false), []);

  return (
    <div className="min-h-screen flex flex-col w-full selection:bg-brand/30 selection:text-text-primary bg-surface text-text-primary">
      <Header
        onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
        isAdminWorkspace={isAdminWorkspace}
      />

      <div className="flex-1 flex w-full">
        {isAdminWorkspace ? (
          <AdminWorkspace isMobileOpen={isMobileSidebarOpen} onMobileClose={closeMobileSidebar}>
            {children}
          </AdminWorkspace>
        ) : (
          <>
            <Sidebar isMobileOpen={isMobileSidebarOpen} onMobileClose={closeMobileSidebar} />
            <main className="flex-1 w-full min-w-0 flex flex-col">{children}</main>
          </>
        )}
      </div>

      {!isAdminWorkspace && <Footer />}
    </div>
  );
}
