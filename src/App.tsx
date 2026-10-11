import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { POSPage } from './pages/POSPage';
import { OrdersPage } from './pages/OrdersPage';
import { ProductsPage } from './pages/ProductsPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { InventoryPage } from './pages/InventoryPage';
import { CustomersPage } from './pages/CustomersPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { StaffPage } from './pages/StaffPage';
import { ReportsPage } from './pages/ReportsPage';
import { DayClosePage } from './pages/DayClosePage';
import { SettingsPage } from './pages/SettingsPage';
import { LoadingSpinner } from './components/ui/LoadingSpinner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-surface">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PermissionRoute({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { hasPermission } = useAuth();

  if (!hasPermission(permission)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { user, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const prevUserIdRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const currentId = user?.id ?? null;
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentId) {
      queryClient.clear();
    }
    prevUserIdRef.current = currentId;
  }, [user, queryClient]);

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-surface">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="pos" element={<POSPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="products" element={<PermissionRoute permission="edit_menu"><ProductsPage /></PermissionRoute>} />
        <Route path="suppliers" element={<PermissionRoute permission="manage_suppliers"><SuppliersPage /></PermissionRoute>} />
        <Route path="inventory" element={<PermissionRoute permission="add_stock_entries"><InventoryPage /></PermissionRoute>} />
        <Route path="customers" element={<PermissionRoute permission="add_customers"><CustomersPage /></PermissionRoute>} />
        <Route path="expenses" element={<PermissionRoute permission="manage_expenses"><ExpensesPage /></PermissionRoute>} />
        <Route path="staff" element={<PermissionRoute permission="manage_staff"><StaffPage /></PermissionRoute>} />
        <Route path="reports" element={<PermissionRoute permission="view_reports"><ReportsPage /></PermissionRoute>} />
        <Route path="day-close" element={<PermissionRoute permission="view_reports"><DayClosePage /></PermissionRoute>} />
        <Route path="settings" element={<PermissionRoute permission="manage_settings"><SettingsPage /></PermissionRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
