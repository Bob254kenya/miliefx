import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { Outlet } from 'react-router-dom';

export default function AppLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <main className="flex-1 overflow-auto">
          <header className="h-12 flex items-center border-b border-border px-4 bg-card/50 backdrop-blur sticky top-0 z-10">
            <SidebarTrigger className="mr-4" />
          </header>
          <div className="p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
