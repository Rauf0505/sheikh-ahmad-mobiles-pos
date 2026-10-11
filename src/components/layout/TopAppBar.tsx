import { useAuth } from '../../hooks/useAuth';

interface TopAppBarProps {
  title?: string;
  shiftActive?: boolean;
}

export function TopAppBar({ title = 'Sheikh Ahmad Mobiles', shiftActive = true }: TopAppBarProps) {
  const { user, logout } = useAuth();

  return (
    <header className="fixed top-0 right-0 left-[80px] lg:left-[240px] flex justify-between items-center h-16 px-4 z-30 bg-surface border-b border-outline-variant">
      <div className="flex items-center gap-4 min-w-0">
        <h2 className="text-[24px] leading-[32px] font-semibold text-primary truncate">{title}</h2>
        <div className="h-6 w-px bg-outline-variant hidden md:block" />
        {shiftActive !== undefined && (
          <span className="bg-secondary-container text-on-secondary-container px-3 py-1 rounded-full text-[14px] font-semibold hidden md:flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary" />
            {shiftActive ? 'Shift Active' : 'No Active Shift'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 lg:gap-4 shrink-0">
        {user && (
          <span className="text-[14px] font-semibold text-on-surface-variant hidden md:block mr-2">
            {user.roleName}
          </span>
        )}
        <button className="w-11 h-11 rounded-full hover:bg-surface-container-low transition-all flex items-center justify-center text-on-surface-variant">
          <span className="material-symbols-outlined">account_circle</span>
        </button>
        <button
          onClick={() => logout()}
          title="Logout"
          className="w-11 h-11 rounded-full hover:bg-error-container transition-all flex items-center justify-center text-on-surface-variant hover:text-error"
        >
          <span className="material-symbols-outlined">logout</span>
        </button>
      </div>
    </header>
  );
}
