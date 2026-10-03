import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Values are lowercase because they must match the `users.role` check
// constraint in Postgres. Labels are the human-readable form.
export const ROLES = [
  { value: "student", label: "Student" },
  { value: "staff", label: "Staff" },
  { value: "admin", label: "Admin" },
];

export const roleLabel = (role) =>
  ROLES.find((option) => option.value === role)?.label ?? role;

export const ROLE_BADGE_CLASS = {
  student: "bg-blue-50 text-blue-700",
  staff: "bg-amber-50 text-amber-700",
  admin: "bg-violet-50 text-violet-700",
};

export function RoleBadge({ role }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
        ROLE_BADGE_CLASS[role] ?? "bg-slate-100 text-slate-600",
      )}
    >
      {role}
    </span>
  );
}

export function RoleSelect({ user, onRoleChange, isUpdating = false, isSelf = false }) {
  return (
    <div className="flex items-center justify-end gap-2">
      {isUpdating && (
        <Loader2 className="size-4 animate-spin text-slate-400" aria-hidden="true" />
      )}

      <select
        value={user.role}
        disabled={isUpdating || isSelf}
        onChange={(event) => onRoleChange(user.id, event.target.value)}
        aria-label={`Change role for ${user.full_name}`}
        title={isSelf ? "You cannot change your own role" : "Change role"}
        className={cn(
          "h-9 min-w-32 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-semibold capitalize text-slate-700 shadow-sm outline-none transition-colors",
          "hover:border-slate-400 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100",
          "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        )}
      >
        {ROLES.map((role) => (
          <option key={role.value} value={role.value}>
            {role.label}
          </option>
        ))}
      </select>
    </div>
  );
}
