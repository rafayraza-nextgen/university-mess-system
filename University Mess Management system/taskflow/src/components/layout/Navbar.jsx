import { ChevronDown, LogOut, Utensils } from "lucide-react";
import { Link } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";

// Human-readable role captions for the badge. These label the role only; the
// name shown next to the avatar always comes from public.users.
const ROLE_LABELS = {
  admin: "System Admin",
  staff: "Cafeteria Staff",
  student: "Student",
};

export function Navbar() {
  const { user, logout } = useAuth();

  if (!user) {
    return (
      <header className="fixed inset-x-0 top-0 z-50 h-16 border-b border-slate-200 bg-white">
        <nav className="mx-auto flex h-full max-w-7xl items-center px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
          <Link
            to="/"
            className="flex items-center gap-2.5 font-bold tracking-tight text-slate-950 no-underline"
          >
            <span className="grid size-9 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
              <Utensils className="size-5" aria-hidden="true" />
            </span>
            <span className="hidden sm:inline">University Mess</span>
          </Link>
        </nav>
      </header>
    );
  }

  const role = String(user.role || "").toLowerCase();
  // Always show the real profile from public.users. The role is presented as a
  // separate badge rather than replacing the person's name, so a staff or admin
  // account is never labelled with a generic role title.
  const displayName = user.name?.trim() || user.email || "User";
  const userInitial = displayName.charAt(0).toUpperCase() || "U";
  const userIdentifier = user.studentId || "N/A";
  const roleLabel = ROLE_LABELS[role] ?? role;

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-16 border-b border-slate-200 bg-white">
      <nav className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
        <Link
          to="/"
          className="flex items-center gap-2.5 font-bold tracking-tight text-slate-950 no-underline"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
            <Utensils className="size-5" aria-hidden="true" />
          </span>
          <span className="hidden sm:inline">University Mess</span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="h-11 gap-2 rounded-full pl-1.5 pr-2.5"
                aria-label={`Open profile menu for ${displayName}`}
              />
            }
          >
            <Avatar>
              <AvatarFallback className="bg-blue-600 text-xs font-bold text-white">
                {userInitial}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-32 truncate text-sm font-semibold text-slate-700 xl:inline">
              {displayName}
            </span>
            <ChevronDown className="size-4 text-slate-400" aria-hidden="true" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" sideOffset={8} className="w-72 min-w-72">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-3 py-3">
                <span className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-900">
                      {displayName}
                    </span>
                    <span className="mt-1 block truncate text-xs font-normal text-slate-500">
                      {user.email}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                    {roleLabel}
                  </span>
                </span>

                <span className="mt-3 block space-y-1 border-t border-slate-100 pt-3">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-slate-500">ID</span>
                    <span className="truncate font-mono text-xs font-semibold text-slate-800">
                      {userIdentifier}
                    </span>
                  </span>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-slate-500">Role</span>
                    <span className="truncate text-xs font-semibold capitalize text-slate-800">
                      {role}
                    </span>
                  </span>
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              variant="destructive"
              onClick={logout}
              className="px-3 py-2.5"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </header>
  );
}
