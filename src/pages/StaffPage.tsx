import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpcQuery } from '../hooks/useDB';
import { useToast } from '../components/ui/Toast';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import type { User, Role, Permission } from '../types';

interface StaffOverride {
  permission_id: number;
  key: string;
  label: string;
  enabled: boolean;
}

interface AuditEntry {
  id: number;
  action: string;
  entity?: string;
  entity_id?: number;
  timestamp: string;
  details?: string;
}

export function StaffPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<User | null>(null);
  const [showActivity, setShowActivity] = useState(false);

  const { data: staffList } = useIpcQuery<User[]>('staff:list', 'staff:list');
  const { data: roles } = useIpcQuery<Role[]>('roles:list', 'roles:list');
  const { data: permissions } = useIpcQuery<Permission[]>('permissions:list', 'permissions:list');
  const { data: overrides } = useQuery({
    queryKey: ['staff:get-overrides', selectedId],
    queryFn: async () => {
      if (!selectedId) return [];
      const result = await window.electronAPI.invoke('staff:get-overrides', selectedId) as {
        success: boolean;
        data?: StaffOverride[];
      };
      return result.data || [];
    },
    enabled: !!selectedId,
  });

  const selectedStaff = staffList?.find((s) => s.id === selectedId);

  const addMutation = useMutation({
    mutationFn: async (data: any) => {
      const result = await window.electronAPI.invoke('staff:create', data) as {
        success: boolean;
        error?: string;
      };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff:list'] });
      setShowAddModal(false);
      toast.success('Staff member added');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add staff'),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: number; name: string; role_id: number; phone?: string; pin?: string }) => {
      const { id, pin, ...fields } = data;
      const result = await window.electronAPI.invoke('staff:update', id, fields) as {
        success: boolean;
        error?: string;
      };
      if (!result.success) throw new Error(result.error);
      if (pin) {
        const pinResult = await window.electronAPI.invoke('staff:update-pin', id, pin) as {
          success: boolean;
          error?: string;
        };
        if (!pinResult.success) throw new Error(pinResult.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff:list'] });
      setEditingStaff(null);
      toast.success('Staff updated');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update staff'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await window.electronAPI.invoke('staff:toggle-active', id) as {
        success: boolean;
        error?: string;
      };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ['staff:list'] });
      toast.success('Staff status updated');
      const s = staffList?.find((x) => x.id === id);
      if (s) {
        queryClient.invalidateQueries({ queryKey: ['staff:get-activity', id] });
        void s;
      }
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update staff status'),
  });

  const { data: activity } = useQuery({
    queryKey: ['staff:get-activity', selectedId],
    queryFn: async () => {
      if (!selectedId) return [];
      const result = await window.electronAPI.invoke('staff:get-activity', selectedId) as {
        success: boolean;
        data?: AuditEntry[];
      };
      return result.data || [];
    },
    enabled: !!selectedId && showActivity,
  });

  const overrideMutation = useMutation({
    mutationFn: async (data: { permission_id: number; allowed: boolean }) => {
      if (!permissions) return;
      const currentMap = new Map<number, boolean>();
      overrides?.forEach((o) => currentMap.set(o.permission_id, o.enabled));
      currentMap.set(data.permission_id, data.allowed);
      const permArray = permissions.map((p) => ({
        permission_id: p.id,
        allowed: currentMap.get(p.id) ? 1 : 0,
      }));
      const result = await window.electronAPI.invoke('staff:set-overrides', selectedId, permArray) as {
        success: boolean;
        error?: string;
      };
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff:get-overrides', selectedId] });
    },
  });

  const permissionGroups = (permissions || []).reduce<Record<string, Permission[]>>(
    (acc, p) => {
      if (!acc[p.category]) acc[p.category] = [];
      acc[p.category].push(p);
      return acc;
    },
    {}
  );

  const isOverridden = (permId: number) => overrides?.find((o) => o.permission_id === permId);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Staff List */}
      <div className="w-[340px] shrink-0 bg-surface border-r border-outline-variant flex flex-col">
        <div className="px-4 py-4 border-b border-outline-variant">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[18px] font-semibold text-on-surface">Staff</h2>
            <Button variant="primary" size="sm" icon="person_add" onClick={() => setShowAddModal(true)}>
              Add
            </Button>
          </div>
          <Input icon="search" placeholder="Search staff..." />
        </div>
        <div className="flex-1 overflow-y-auto">
          {staffList?.map((staff) => (
            <button
              key={staff.id}
              onClick={() => setSelectedId(staff.id)}
              className={cn(
                'w-full text-left px-4 py-3 border-b border-outline-variant transition-colors',
                selectedId === staff.id
                  ? 'bg-surface-container-low border-l-4 border-l-primary'
                  : 'hover:bg-surface-container-low border-l-4 border-l-transparent'
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-[14px] font-semibold text-on-surface">{staff.name}</p>
                <Badge variant={staff.active ? 'success' : 'neutral'}>
                  {staff.active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <p className="text-[12px] text-on-surface-variant mt-0.5">{(staff as any).role_name}</p>
              {staff.phone && (
                <p className="text-[11px] text-on-surface-variant">{staff.phone}</p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Staff Detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedStaff ? (
          <div className="flex flex-col items-center justify-center h-full text-on-surface-variant gap-3">
            <span className="material-symbols-outlined text-[48px]">badge</span>
            <p className="text-[16px]">Select a staff member to view details</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-[24px] font-bold text-on-surface">
                  {selectedStaff.name}
                </h1>
                <p className="text-[14px] text-on-surface-variant mt-1">
                  {(selectedStaff as any).role_name} &middot; {selectedStaff.phone || 'No phone'}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Button
                  variant={selectedStaff.active ? 'danger' : 'primary'}
                  icon={selectedStaff.active ? 'block' : 'check_circle'}
                  loading={toggleActiveMutation.isPending}
                  onClick={() => toggleActiveMutation.mutate(selectedStaff.id)}
                >
                  {selectedStaff.active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  variant="secondary"
                  icon="edit"
                  onClick={() => setEditingStaff(selectedStaff)}
                >
                  Edit Staff
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowActivity((s) => !s)}
                className={cn(
                  'px-4 py-2 rounded-lg text-[13px] font-semibold transition-all',
                  showActivity ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                )}
              >
                Activity Log
              </button>
            </div>

            {showActivity && (
              <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
                <div className="grid grid-cols-[160px_120px_120px_1fr] gap-2 px-5 py-3 bg-surface-container text-[12px] font-semibold text-on-surface-variant uppercase tracking-wide">
                  <span>Time</span><span>Action</span><span>Entity</span><span>Details</span>
                </div>
                {(activity || []).length === 0 ? (
                  <div className="px-5 py-8 text-center text-[14px] text-on-surface-variant">No activity recorded yet.</div>
                ) : (
                  (activity || []).map((a) => (
                    <div key={a.id} className="grid grid-cols-[160px_120px_120px_1fr] gap-2 px-5 py-3 border-t border-outline-variant items-center text-[13px]">
                      <span className="text-on-surface-variant">{a.timestamp}</span>
                      <span className="font-medium text-on-surface">{a.action}</span>
                      <span className="text-on-surface-variant">{a.entity ? `${a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}` : '—'}</span>
                      <span className="text-on-surface-variant truncate">{a.details || '—'}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            <div>
              <h3 className="text-[16px] font-semibold text-on-surface mb-4">
                Permission Overrides
              </h3>
              <p className="text-[13px] text-on-surface-variant mb-4">
                Toggle permissions to override the default role settings for this staff member.
              </p>
              <div className="space-y-4">
                {Object.entries(permissionGroups).map(([category, perms]) => (
                  <div
                    key={category}
                    className="bg-surface border border-outline-variant rounded-xl p-4"
                  >
                    <h4 className="text-[13px] font-semibold text-on-surface-variant uppercase tracking-wide mb-3">
                      {category}
                    </h4>
                    <div className="space-y-2">
                      {perms.map((perm) => {
                        const override = isOverridden(perm.id);
                        return (
                          <div
                            key={perm.key}
                            className="flex items-center justify-between py-1"
                          >
                            <span className="text-[14px] text-on-surface">
                              {perm.label}
                            </span>
                            <button
                              onClick={() =>
                                overrideMutation.mutate({
                                  permission_id: perm.id,
                                  allowed: override ? !override.enabled : true,
                                })
                              }
                              className={cn(
                                'w-11 h-6 rounded-full transition-colors relative',
                                override?.enabled
                                  ? 'bg-primary'
                                  : 'bg-outline-variant'
                              )}
                            >
                              <div
                                className={cn(
                                  'w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform',
                                  override?.enabled
                                    ? 'translate-x-5.5'
                                    : 'translate-x-0.5'
                                )}
                              />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Staff Modal */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Staff Member"
      >
        <StaffForm
          roles={roles || []}
          onSubmit={(data) => addMutation.mutate(data)}
          loading={addMutation.isPending}
        />
      </Modal>

      {/* Edit Staff Modal */}
      <Modal
        open={!!editingStaff}
        onClose={() => setEditingStaff(null)}
        title="Edit Staff Member"
      >
        {editingStaff && (
          <StaffForm
            roles={roles || []}
            initial={{
              name: editingStaff.name,
              role_id: String(editingStaff.role_id),
              phone: editingStaff.phone || '',
              pin: '',
            }}
            onSubmit={(data) =>
              updateMutation.mutate({ id: editingStaff.id, ...data })
            }
            loading={updateMutation.isPending}
            isEdit
          />
        )}
      </Modal>
    </div>
  );
}

function StaffForm({
  roles,
  initial,
  onSubmit,
  loading,
  isEdit,
}: {
  roles: Role[];
  initial?: { name: string; role_id: string; phone: string; pin: string };
  onSubmit: (data: any) => void;
  loading: boolean;
  isEdit?: boolean;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [roleId, setRoleId] = useState(initial?.role_id || '');
  const [pin, setPin] = useState(initial?.pin || '');
  const [phone, setPhone] = useState(initial?.phone || '');

  return (
    <div className="space-y-4">
      <Input
        label="Full Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Staff member name"
      />
      <div>
        <label className="text-[14px] font-semibold text-on-surface-variant mb-1 block">
          Role
        </label>
        <select
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          className="w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 text-[14px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Select role</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label={isEdit ? 'New PIN (leave blank to keep)' : 'PIN'}
          type="password"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="6-digit PIN"
        />
        <Input
          label="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0300-1234567"
        />
      </div>
      <Button
        variant="primary"
        className="w-full"
        loading={loading}
        disabled={!name || !roleId || (!isEdit && !pin)}
        onClick={() =>
          onSubmit({
            name,
            role_id: Number(roleId),
            pin: pin || undefined,
            phone: phone || null,
          })
        }
      >
        {isEdit ? 'Update Staff' : 'Add Staff'}
      </Button>
    </div>
  );
}
