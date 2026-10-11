import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getInitials, cn } from '../../lib/utils';
import logoUrl from '../../assets/logo.png';

interface NavItem {
  icon: string;
  label: string;
  path: string;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { icon: 'dashboard', label: 'Dashboard', path: '/' },
  { icon: 'point_of_sale', label: 'POS', path: '/pos' },
  { icon: 'receipt_long', label: 'Sales', path: '/orders' },
  { icon: 'phone_android', label: 'Products', path: '/products', permission: 'edit_menu' },
  { icon: 'local_shipping', label: 'Purchases', path: '/suppliers', permission: 'manage_suppliers' },
  { icon: 'inventory_2', label: 'Stock', path: '/inventory', permission: 'add_stock_entries' },
  { icon: 'groups', label: 'Customers', path: '/customers', permission: 'add_customers' },
  { icon: 'payments', label: 'Expenses', path: '/expenses', permission: 'manage_expenses' },
  { icon: 'badge', label: 'Staff', path: '/staff', permission: 'manage_staff' },
  { icon: 'assessment', label: 'Reports', path: '/reports', permission: 'view_reports' },
  { icon: 'summarize', label: 'Day Close', path: '/day-close', permission: 'view_reports' },
  { icon: 'settings', label: 'Settings', path: '/settings', permission: 'manage_settings' },
];

export function Sidebar() {
  const { user, hasPermission, logout } = useAuth();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(item.permission)
  );

  return (
    <aside className="fixed left-0 top-0 h-screen flex flex-col z-40 bg-primary w-[80px] lg:w-[240px] border-r border-primary-container">
      <div className="h-16 flex items-center px-4 lg:px-6 shrink-0">
        <img
          src={logoUrl}
          alt="Sheikh Ahmad Mobiles"
          className="w-10 h-10 object-contain mr-3"
          draggable={false}
        />
        <h1 className="text-[24px] leading-[32px] font-semibold text-on-primary truncate hidden lg:block">
          Sheikh Ahmad Mobiles
        </h1>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 flex flex-col gap-1 px-2">
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center px-3 lg:px-4 h-12 rounded-xl transition-all group relative overflow-hidden min-h-[44px]',
                isActive
                  ? 'bg-on-primary-fixed-variant text-primary-fixed font-bold scale-95 duration-100 shadow-[inset_0px_2px_4px_rgba(0,0,0,0.2)]'
                  : 'text-on-primary opacity-70 hover:opacity-100 hover:bg-primary-container hover:text-on-primary-container'
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn('material-symbols-outlined text-[24px] shrink-0', isActive && 'icon-fill-1')}>
                  {item.icon}
                </span>
                <span className="ml-4 hidden lg:block truncate">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 lg:p-6 shrink-0 border-t border-primary-container">
        <button
          onClick={logout}
          className="flex items-center w-full hover:bg-primary-container transition-colors rounded-lg p-1"
        >
          <div className="w-10 h-10 rounded-full bg-tertiary-fixed-dim flex items-center justify-center text-on-tertiary-fixed font-bold text-sm shrink-0">
            {user ? getInitials(user.name) : 'U'}
          </div>
          <div className="ml-3 hidden lg:block text-left">
            <p className="text-[14px] leading-[20px] font-semibold text-on-primary truncate">
              {user?.name || 'User'}
            </p>
            <p className="text-[12px] leading-[16px] text-primary-fixed">
              {user?.roleName || 'Role'}
            </p>
          </div>
        </button>
      </div>
    </aside>
  );
}
