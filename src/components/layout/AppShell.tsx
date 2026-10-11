import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopAppBar } from './TopAppBar';
import { ToastProvider } from '../ui/Toast';
import { cn } from '../../lib/utils';

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPOS = location.pathname === '/pos';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('[data-close-modal]').forEach((el) => (el as HTMLElement).click());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <ToastProvider>
      <div className="h-screen w-full overflow-hidden flex bg-background">
        {!isPOS && <Sidebar />}
        <main
          className={cn(
            'flex-1 flex flex-col h-full relative',
            !isPOS && 'ml-[80px] lg:ml-[240px]'
          )}
        >
          {!isPOS && <TopAppBar />}
          <div className={cn('flex-1 overflow-hidden', !isPOS && 'mt-16')}>
            <Outlet />
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
