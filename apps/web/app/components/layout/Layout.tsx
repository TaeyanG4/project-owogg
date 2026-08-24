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
  const [isMobileAdminSidebarOpen, setIsMobileAdminSidebarOpen] = useState(false);
  const isAdminWorkspace =
    location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  const closeMobileSidebar = useCallback(() => setIsMobileSidebarOpen(false), []);
  const closeMobileAdminSidebar = useCallback(() => setIsMobileAdminSidebarOpen(false), []);
  const toggleMobileSidebar = useCallback(() => {
    setIsMobileAdminSidebarOpen(false);
    setIsMobileSidebarOpen((previous) => !previous);
  }, []);
  const openMobileAdminSidebar = useCallback(() => {
    setIsMobileSidebarOpen(false);
    setIsMobileAdminSidebarOpen(true);
  }, []);

  return (
    <div className="min-h-screen flex flex-col w-full selection:bg-brand/30 selection:text-text-primary bg-surface text-text-primary">
      <Header onToggleMobileSidebar={toggleMobileSidebar} isAdminWorkspace={isAdminWorkspace} />

      <div className="flex-1 flex w-full">
        <Sidebar isMobileOpen={isMobileSidebarOpen} onMobileClose={closeMobileSidebar} />
        {isAdminWorkspace ? (
          <AdminWorkspace
            isMobileOpen={isMobileAdminSidebarOpen}
            onMobileOpen={openMobileAdminSidebar}
            onMobileClose={closeMobileAdminSidebar}
          >
            {children}
          </AdminWorkspace>
        ) : (
          <main className="flex-1 w-full min-w-0 flex flex-col">{children}</main>
        )}
      </div>

      {!isAdminWorkspace && <Footer />}
    </div>
  );
}
