import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIpcQuery } from '../hooks/useDB';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ui/Toast';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Card } from '../components/ui/Card';
import type { Role, Permission } from '../types';

interface RoleWithPerms extends Role {
  permissions?: Array<{ key: string; allowed: number }>;
}

interface AuditEntry {
  id: number;
  user_id: number;
  user_name?: string;
  action: string;
  entity?: string;
  entity_id?: number;
  timestamp: string;
  details?: string;
}

type SectionKey = 'roles' | 'business' | 'terminal' | 'stock' | 'receipt' | 'audit' | 'backup';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState<SectionKey>('roles');
  const [editingRole, setEditingRole] = useState<RoleWithPerms | null>(null);
  const [showAddRole, setShowAddRole] = useState(false);
  const [localPerms, setLocalPerms] = useState<Record<string, boolean>>({});

  const { data: roles } = useIpcQuery<RoleWithPerms[]>('roles:list', 'roles:list');
  const { data: permissions } = useIpcQuery<Permission[]>('permissions:list', 'permissions:list');
  const { data: settings } = useIpcQuery<Record<string, string>>('settings:get', 'settings:get');
  const { data: auditEntries } = useIpcQuery<AuditEntry[]>('audit:list', 'audit:list', { limit: 300 });

  useEffect(() => {
    if (editingRole?.permissions) {
      const permMap: Record<string, boolean> = {};
      for (const p of editingRole.permissions) {
        permMap[p.key] = !!p.allowed;
      }
      setLocalPerms(permMap);
    }
  }, [editingRole]);

  const addRoleMutation = useMutation({
    mutationFn: async (name: string) => {
      const result = await window.electronAPI.invoke('roles:create', name) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles:list'] });
      setShowAddRole(false);
      toast.success('Role created');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to create role'),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await window.electronAPI.invoke('roles:delete', id) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles:list'] });
      setEditingRole(null);
      toast.success('Role deleted');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to delete role'),
  });

  const savePermissionsMutation = useMutation({
    mutationFn: async () => {
      if (!editingRole || !permissions) return;
      const permArray = permissions.map((p) => ({
        permission_id: p.id,
        allowed: localPerms[p.key] ? 1 : 0,
      }));
      const result = await window.electronAPI.invoke('roles:update-permissions', editingRole.id, permArray) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles:list'] });
      toast.success('Permissions saved');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save permissions'),
  });

  const permissionGroups = (permissions || []).reduce<Record<string, Permission[]>>(
    (acc, p) => {
      if (!acc[p.category]) acc[p.category] = [];
      acc[p.category].push(p);
      return acc;
    },
    {}
  );

  const sections: Array<{ key: SectionKey; label: string; icon: string }> = [
    { key: 'roles', label: 'Roles & Permissions', icon: 'admin_panel_settings' },
    { key: 'business', label: 'Business Profile', icon: 'storefront' },
    { key: 'terminal', label: 'Printer Settings', icon: 'computer' },
    { key: 'stock', label: 'Stock Settings', icon: 'inventory_2' },
    { key: 'receipt', label: 'Receipt Settings', icon: 'receipt_long' },
    { key: 'audit', label: 'Audit Log', icon: 'history' },
    { key: 'backup', label: 'Cloud Backup', icon: 'cloud_upload' },
  ];

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-[240px] shrink-0 bg-surface border-r border-outline-variant p-4 overflow-y-auto">
        <h2 className="text-[18px] font-semibold text-on-surface mb-4">Settings</h2>
        <div className="space-y-1">
          {sections.map((section) => (
            <button
              key={section.key}
              onClick={() => setActiveSection(section.key)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all',
                activeSection === section.key
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              )}
            >
              <span className="material-symbols-outlined text-[20px]">{section.icon}</span>
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeSection === 'roles' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-[24px] font-bold text-on-surface">Roles & Permissions</h1>
              <Button variant="primary" icon="add" onClick={() => setShowAddRole(true)}>Add Role</Button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <h3 className="text-[14px] font-semibold text-on-surface-variant mb-3 uppercase tracking-wide">Roles</h3>
                <div className="space-y-2">
                  {roles?.map((role) => (
                    <div
                      key={role.id}
                      className={cn(
                        'flex items-center justify-between px-4 py-3 rounded-xl border transition-colors',
                        editingRole?.id === role.id
                          ? 'bg-surface-container-low border-primary'
                          : 'bg-surface border-outline-variant hover:bg-surface-container-low'
                      )}
                    >
                      <div>
                        <p className="text-[14px] font-semibold text-on-surface">{role.name}</p>
                        {role.is_system ? <p className="text-[11px] text-on-surface-variant">System Role</p> : null}
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingRole(role)}
                          className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">edit</span>
                        </button>
                        {!role.is_system && (
                          <button
                            onClick={() => deleteRoleMutation.mutate(role.id)}
                            className="w-8 h-8 rounded-lg hover:bg-error-container/30 flex items-center justify-center transition-colors"
                          >
                            <span className="material-symbols-outlined text-[16px] text-error">delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {editingRole && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[14px] font-semibold text-on-surface-variant uppercase tracking-wide">Permissions — {editingRole.name}</h3>
                    <Button variant="primary" size="sm" onClick={() => savePermissionsMutation.mutate()} loading={savePermissionsMutation.isPending}>Save</Button>
                  </div>
                  <div className="space-y-4">
                    {Object.entries(permissionGroups).map(([category, perms]) => (
                      <div key={category} className="bg-surface border border-outline-variant rounded-xl p-4">
                        <h4 className="text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide mb-3">{category}</h4>
                        <div className="space-y-2">
                          {perms.map((perm) => (
                            <div key={perm.key} className="flex items-center justify-between py-1">
                              <span className="text-[13px] text-on-surface">{perm.label}</span>
                              <button
                                onClick={() => setLocalPerms((prev) => ({ ...prev, [perm.key]: !prev[perm.key] }))}
                                className={cn('w-11 h-6 rounded-full transition-colors relative', localPerms[perm.key] ? 'bg-primary' : 'bg-outline-variant')}
                              >
                                <div className={cn('w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform', localPerms[perm.key] ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeSection === 'business' && (
          <BusinessProfileSection settings={settings} onSaved={() => toast.success('Business profile saved')} />
        )}

        {activeSection === 'terminal' && (
          <TerminalSettingsSection settings={settings} onSaved={() => toast.success('Printer settings saved')} />
        )}

        {activeSection === 'stock' && (
          <StockConfigSection settings={settings} onSaved={() => toast.success('Stock settings saved')} />
        )}

        {activeSection === 'receipt' && (
          <ReceiptSettingsSection settings={settings} onSaved={() => toast.success('Receipt settings saved')} />
        )}

        {activeSection === 'audit' && (
          <AuditLogSection entries={auditEntries} currentUserName={user?.name} />
        )}

        {activeSection === 'backup' && <CloudBackupSection onSaved={() => toast.success('Backup settings saved')} />}
      </div>

      <Modal open={showAddRole} onClose={() => setShowAddRole(false)} title="Add Role" size="sm">
        <AddRoleForm onSubmit={(name) => addRoleMutation.mutate(name)} loading={addRoleMutation.isPending} />
      </Modal>
    </div>
  );
}

function AddRoleForm({ onSubmit, loading }: { onSubmit: (name: string) => void; loading: boolean }) {
  const [name, setName] = useState('');
  return (
    <div className="space-y-4">
      <Input label="Role Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales Staff" />
      <Button variant="primary" className="w-full" loading={loading} disabled={!name} onClick={() => onSubmit(name)}>Create Role</Button>
    </div>
  );
}

function useSaveSettings(onSaved?: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const result = await window.electronAPI.invoke('settings:update-many', values) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings:get'] });
      toast.success('Settings saved');
      onSaved?.();
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save settings'),
  });
  return mutation;
}

function BusinessProfileSection({ settings, onSaved }: { settings?: Record<string, string>; onSaved?: () => void }) {
  const [form, setForm] = useState({ business_name: '', business_address: '', business_phone: '', business_ntn: '' });
  useEffect(() => {
    if (settings) setForm((f) => ({
      business_name: settings.business_name ?? f.business_name,
      business_address: settings.business_address ?? f.business_address,
      business_phone: settings.business_phone ?? f.business_phone,
      business_ntn: settings.business_ntn ?? f.business_ntn,
    }));
  }, [settings]);
  const save = useSaveSettings(onSaved);
  return (
    <div className="space-y-6">
      <h1 className="text-[24px] font-bold text-on-surface">Business Profile</h1>
      <Card className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Business Name" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} placeholder="Sheikh Ahmad Mobiles" />
          <Input label="Phone" value={form.business_phone} onChange={(e) => setForm({ ...form, business_phone: e.target.value })} />
          <Input label="Address" value={form.business_address} onChange={(e) => setForm({ ...form, business_address: e.target.value })} />
          <Input label="National Tax Number (NTN)" value={form.business_ntn} onChange={(e) => setForm({ ...form, business_ntn: e.target.value })} />
        </div>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>Save Business Profile</Button>
      </Card>
    </div>
  );
}

function StockConfigSection({ settings, onSaved }: { settings?: Record<string, string>; onSaved?: () => void }) {
  const [allowNegative, setAllowNegative] = useState('0');
  const [defaultSaleType, setDefaultSaleType] = useState('retail');
  useEffect(() => {
    if (settings?.stock_allow_negative !== undefined) setAllowNegative(settings.stock_allow_negative);
    if (settings?.default_sale_type !== undefined) setDefaultSaleType(settings.default_sale_type);
  }, [settings]);
  const save = useSaveSettings(onSaved);
  return (
    <div className="space-y-6">
      <h1 className="text-[24px] font-bold text-on-surface">Stock Settings</h1>
      <Card className="space-y-4">
        <p className="text-[13px] text-on-surface-variant">
          Configure how stock is validated at the point of sale and the default sale type for new orders.
        </p>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={allowNegative === '1'}
            onChange={(e) => setAllowNegative(e.target.checked ? '1' : '0')}
            className="w-4 h-4 accent-primary"
          />
          <div>
            <span className="text-[14px] text-on-surface">Allow sales below zero stock</span>
            <p className="text-[12px] text-on-surface-variant">
              When off, the POS blocks a sale if a product has insufficient stock. When on, stock is allowed to go negative.
            </p>
          </div>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-on-surface-variant mb-1">Default Sale Type</label>
            <select
              value={defaultSaleType}
              onChange={(e) => setDefaultSaleType(e.target.value)}
              className="w-full h-11 rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
            </select>
          </div>
        </div>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ stock_allow_negative: allowNegative, default_sale_type: defaultSaleType })}>
          Save Stock Settings
        </Button>
      </Card>
    </div>
  );
}

function TerminalSettingsSection({ settings, onSaved }: { settings?: Record<string, string>; onSaved?: () => void }) {
  const [printerType, setPrinterType] = useState('blackcopper');
  const [printerInterface, setPrinterInterface] = useState('usb');
  const [printerName, setPrinterName] = useState('Black Copper 80');
  const [testResult, setTestResult] = useState<{ success: boolean; connected: boolean; error?: string } | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (settings) {
      if (settings.printer_type) setPrinterType(settings.printer_type);
      if (settings.printer_interface) setPrinterInterface(settings.printer_interface);
      if (settings.printer_name) setPrinterName(settings.printer_name);
    }
  }, [settings]);
  const save = useSaveSettings(onSaved);

  const testPrinter = async () => {
    setTestResult(null);
    try {
      const result = await window.electronAPI.invoke('printer:test') as { success: boolean; connected: boolean; error?: string };
      setTestResult(result);
      if (result.connected) toast.success('Printer connected');
      else toast.error(result.error || 'Printer not connected');
    } catch (err: any) {
      setTestResult({ success: false, connected: false, error: err.message });
      toast.error('Test failed: ' + err.message);
    }
  };

  const testPrint = async () => {
    try {
      const result = await window.electronAPI.invoke('printer:test-print') as { success: boolean; error?: string };
      if (result.success) toast.success('Test receipt printed');
      else toast.error(result.error || 'Test print failed');
    } catch (err: any) {
      toast.error('Test print failed: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-[24px] font-bold text-on-surface">Printer Settings</h1>
      <Card className="space-y-4">
        <h2 className="text-[16px] font-semibold text-on-surface">Thermal Printer</h2>
        <p className="text-[13px] text-on-surface-variant">
          Configure your ESC/POS thermal printer. Prints through the Windows Print Spooler (driver must be installed on your system).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[13px] font-medium text-on-surface mb-1 block">Printer Type</span>
            <select
              value={printerType}
              onChange={(e) => setPrinterType(e.target.value)}
              className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="blackcopper">BlackCopper (BC-87AC / BC-98AC)</option>
              <option value="epson">Epson (TM-T80/T82/T88)</option>
              <option value="star">Star Micronics</option>
              <option value="tanca">TANCA</option>
              <option value="daruma">Daruma</option>
              <option value="brother">Brother</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[13px] font-medium text-on-surface mb-1 block">Connection</span>
            <select
              value={printerInterface}
              onChange={(e) => setPrinterInterface(e.target.value)}
              className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="usb">USB (via Windows Print Spooler)</option>
              <option value="network">Network (TCP/IP)</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-[13px] font-medium text-on-surface mb-1 block">Windows Printer Name</span>
          <input
            type="text"
            value={printerName}
            onChange={(e) => setPrinterName(e.target.value)}
            placeholder="Black Copper 80"
            className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <span className="text-[12px] text-on-surface-variant mt-1 block">
            Must match the name in Windows Settings &gt; Printers &amp; Scanners
          </span>
        </label>
        <div className="flex gap-3">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ printer_type: printerType, printer_interface: printerInterface, printer_name: printerName.trim() })}>Save Settings</Button>
          <Button variant="secondary" icon="print" onClick={testPrinter}>Test Connection</Button>
          <Button variant="secondary" icon="receipt_long" onClick={testPrint}>Test Print</Button>
        </div>
        {testResult && (
          <div className={`flex items-center gap-2 p-3 rounded-xl text-[13px] ${testResult.connected ? 'bg-success-container/30 text-on-surface' : 'bg-error-container/30 text-on-surface'}`}>
            <span className="material-symbols-outlined text-[18px]">{testResult.connected ? 'check_circle' : 'error'}</span>
            {testResult.connected ? 'Printer is connected and ready' : (testResult.error || 'Printer not found. Check connection.')}
          </div>
        )}
      </Card>
      <Card className="space-y-3">
        <h2 className="text-[16px] font-semibold text-on-surface">Supported Printers</h2>
        <div className="text-[13px] text-on-surface-variant space-y-1">
          <p>BlackCopper BC-87AC / BC-98AC (80mm, USB, ESC/POS)</p>
          <p>Epson TM-T82 / TM-T88 (Recommended — most reliable)</p>
          <p>XPRINTER XP-80C / XP-T80C (Budget-friendly, widely available in Pakistan)</p>
          <p>Star Micronics TSP series</p>
          <p>Any ESC/POS compatible thermal printer (80mm paper)</p>
        </div>
      </Card>
    </div>
  );
}

function ReceiptSettingsSection({ settings, onSaved }: { settings?: Record<string, string>; onSaved?: () => void }) {
  const [form, setForm] = useState({ receipt_header: '', receipt_footer: '' });
  useEffect(() => {
    if (settings) setForm((f) => ({
      receipt_header: settings.receipt_header ?? f.receipt_header,
      receipt_footer: settings.receipt_footer ?? f.receipt_footer,
    }));
  }, [settings]);
  const save = useSaveSettings(onSaved);
  return (
    <div className="space-y-6">
      <h1 className="text-[24px] font-bold text-on-surface">Receipt Customization</h1>
      <Card className="space-y-4">
        <div className="space-y-3">
          <label className="block">
            <span className="text-[13px] font-medium text-on-surface mb-1 block">Receipt Header</span>
            <textarea
              value={form.receipt_header}
              onChange={(e) => setForm({ ...form, receipt_header: e.target.value })}
              rows={3}
              className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          <label className="block">
            <span className="text-[13px] font-medium text-on-surface mb-1 block">Receipt Footer</span>
            <textarea
              value={form.receipt_footer}
              onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })}
              rows={3}
              className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
        </div>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>Save Receipt Settings</Button>
      </Card>
    </div>
  );
}

function AuditLogSection({ entries, currentUserName }: { entries?: AuditEntry[]; currentUserName?: string }) {
  const [search, setSearch] = useState('');
  const filtered = (entries || []).filter((e) =>
    !search || [e.action, e.entity, String(e.entity_id ?? ''), e.details ?? '']
      .join(' ').toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-bold text-on-surface">Audit Log</h1>
        <Input
          placeholder="Search log..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-[240px]"
        />
      </div>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-container-low text-on-surface-variant uppercase tracking-wide text-[11px]">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Time</th>
                <th className="text-left px-4 py-3 font-semibold">User</th>
                <th className="text-left px-4 py-3 font-semibold">Action</th>
                <th className="text-left px-4 py-3 font-semibold">Entity</th>
                <th className="text-left px-4 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/50">
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">{e.timestamp}</td>
                  <td className="px-4 py-3 text-on-surface">{e.user_name || `User #${e.user_id}`}</td>
                  <td className="px-4 py-3 text-on-surface font-medium">{e.action}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{e.entity ? `${e.entity}${e.entity_id ? ` #${e.entity_id}` : ''}` : '—'}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{e.details || '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-on-surface-variant">No log entries found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function CloudBackupSection({ onSaved }: { onSaved?: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [configured, setConfigured] = useState(false);
  const [secretSaved, setSecretSaved] = useState(false);

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['backup:status'],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('backup:status') as any;
      return result;
    },
    refetchInterval: 30000,
  });

  const { data: config } = useQuery({
    queryKey: ['backup:get-config'],
    queryFn: async () => {
      const result = await window.electronAPI.invoke('backup:get-config') as any;
      return result;
    },
  });

  useEffect(() => {
    if (config) {
      setConfigured(config.configured);
      setSecretSaved(config.hasSecret);
      if (config.clientId) setClientId(config.clientId);
    }
  }, [config]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      const result = await window.electronAPI.invoke('backup:configure', { clientId: clientId.trim(), clientSecret: clientSecret.trim() }) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      setConfigured(true);
      setSecretSaved(true);
      setClientSecret('');
      toast.success('Google Drive credentials saved');
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ['backup:get-config'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  const connectDrive = useMutation({
    mutationFn: async () => {
      const result = await window.electronAPI.invoke('backup:connect-drive') as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      toast.success('Google Drive connected');
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ['backup:status'] });
    },
    onError: (e: any) => toast.error(e.message || 'Connection failed'),
  });

  const disconnectDrive = useMutation({
    mutationFn: async () => {
      const result = await window.electronAPI.invoke('backup:disconnect-drive') as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      toast.success('Google Drive disconnected');
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ['backup:status'] });
    },
    onError: (e: any) => toast.error(e.message || 'Disconnect failed'),
  });

  const backupNow = useMutation({
    mutationFn: async () => {
      const result = await window.electronAPI.invoke('backup:now') as any;
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: (result: any) => {
      if (result.uploaded) {
        toast.success('Backup created and uploaded to Google Drive');
      } else {
        toast.success('Backup created locally' + (result.uploadError ? ` (upload failed: ${result.uploadError})` : ''));
      }
      refetchStatus();
    },
    onError: (e: any) => toast.error(e.message || 'Backup failed'),
  });

  const openFolder = useMutation({
    mutationFn: async () => {
      await window.electronAPI.invoke('backup:open-folder');
    },
  });

  const isDriveConnected = status?.isDriveConnected;

  return (
    <div className="space-y-6">
      <h1 className="text-[24px] font-bold text-on-surface">Cloud Backup</h1>

      <Card className="space-y-4">
        <h2 className="text-[16px] font-semibold text-on-surface">Google Drive Configuration</h2>
        <p className="text-[13px] text-on-surface-variant">
          Enter your Google Cloud Console OAuth credentials to enable automatic backups to Google Drive.
        </p>
        <div className="space-y-3">
          <Input
            label="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="xxxx.apps.googleusercontent.com"
          />
          <div>
            <Input
              label={secretSaved ? 'Client Secret (saved)' : 'Client Secret'}
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={secretSaved ? '•••••••••••••••• (saved)' : 'Enter client secret'}
            />
            {secretSaved && !clientSecret && (
              <p className="text-[11px] text-primary mt-1">Secret is saved. Leave blank to keep existing, or type new value to replace.</p>
            )}
          </div>
        </div>
        <Button
          variant="primary"
          loading={saveConfig.isPending}
          onClick={() => saveConfig.mutate()}
          disabled={!clientId || !clientSecret}
        >
          Save Credentials
        </Button>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-[16px] font-semibold text-on-surface">Connection Status</h2>
        {isDriveConnected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-success-container flex items-center justify-center">
                <span className="material-symbols-outlined text-on-success-container text-[20px]">cloud_done</span>
              </div>
              <div>
                <p className="text-[14px] font-medium text-on-surface">Connected to Google Drive</p>
                <p className="text-[12px] text-on-surface-variant">Backups upload automatically every hour</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon="link_off"
              loading={disconnectDrive.isPending}
              onClick={() => disconnectDrive.mutate()}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-warning-container flex items-center justify-center">
                <span className="material-symbols-outlined text-on-warning-container text-[20px]">cloud_off</span>
              </div>
              <div>
                <p className="text-[14px] font-medium text-on-surface">Not Connected</p>
                <p className="text-[12px] text-on-surface-variant">Save credentials above, then connect</p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              icon="cloud_upload"
              loading={connectDrive.isPending}
              disabled={!configured}
              onClick={() => connectDrive.mutate()}
            >
              Connect Google Drive
            </Button>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-[16px] font-semibold text-on-surface">Backup</h2>
        <div className="grid grid-cols-2 gap-4 text-[13px]">
          <div>
            <p className="text-on-surface-variant">Schedule</p>
            <p className="font-medium text-on-surface">Every hour (6 AM – 11 PM)</p>
          </div>
          <div>
            <p className="text-on-surface-variant">Retention</p>
            <p className="font-medium text-on-surface">30 days</p>
          </div>
          <div>
            <p className="text-on-surface-variant">Last Backup</p>
            <p className="font-medium text-on-surface">
              {status?.lastBackupTime ? new Date(status.lastBackupTime).toLocaleString() : 'No backup yet'}
            </p>
          </div>
          <div>
            <p className="text-on-surface-variant">Local Backups</p>
            <p className="font-medium text-on-surface">{status?.localBackupCount || 0} files</p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <Button
            variant="primary"
            icon="backup"
            loading={backupNow.isPending}
            onClick={() => backupNow.mutate()}
          >
            Backup Now
          </Button>
          <Button
            variant="secondary"
            icon="folder_open"
            loading={openFolder.isPending}
            onClick={() => openFolder.mutate()}
          >
            Open Backup Folder
          </Button>
        </div>
      </Card>
    </div>
  );
}
