import { useMemo } from "react";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RoleSelect } from "@/pages/admin/RoleSelect";
import { formatCurrency } from "@/lib/ledger";
import { cn } from "@/lib/utils";

export function StudentDirectory({
  users,
  duesByStudent,
  onRoleChange,
  onClearDues,
  clearingUserIds,
  updatingUserIds,
  isLoading,
  currentUserId,
  duesError = "",
}) {
  const students = useMemo(
    () => users.filter((user) => user.role === "student"),
    [users],
  );

  return (
    <Card className="w-full border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-200">
        <CardTitle>Student Directory</CardTitle>
        <CardDescription>
          {isLoading
            ? "Loading student accounts..."
            : `${students.length} student account${students.length === 1 ? "" : "s"}. Dues are summed from each student's unpaid meals. Settle them to restore a suspended account.`}
        </CardDescription>
      </CardHeader>
      {duesError && (
        <div
          role="alert"
          className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {duesError} Dues columns below are unavailable, and Clear Dues is disabled
          until they load.
        </div>
      )}

      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Student ID</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Dues</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => {
              const dues = duesByStudent?.[student.id] ?? { total: 0, months: [] };
              const isSuspended = student.accountStatus === "suspended";
              const isClearing = clearingUserIds.includes(student.id);
              // Never offer to settle on a balance we could not read.
              const canSettle = !duesError && (dues.total > 0 || isSuspended);
              const monthsLabel = dues.months.length
                ? `${dues.months.length} month${dues.months.length === 1 ? "" : "s"}`
                : "no meals charged";

              return (
                <TableRow key={student.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {student.full_name}
                      </span>
                      {isSuspended && (
                        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                          Suspended
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium text-slate-600">
                    {student.student_id || "—"}
                  </TableCell>
                  <TableCell className="text-slate-600">{student.email}</TableCell>

                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      <span
                        className={cn(
                          "font-bold",
                          dues.total > 0 ? "text-amber-700" : "text-slate-400",
                        )}
                      >
                        {/* A confirmed zero renders $0.00, but a dues load that
                            failed must not masquerade as one: showing $0.00 for
                            unknown balances is how a broken query reads as a
                            fully settled mess. */}
                        {duesError ? "unavailable" : formatCurrency(dues.total)}
                      </span>

                      {/* Consumed meals whose menu has no price total to zero.
                          Without this they are indistinguishable from a settled
                          account, which is exactly the "owes nothing but has
                          unpaid meals" case. */}
                      {!duesError && dues.unpriced > 0 && (
                        <span
                          className="text-[10px] font-semibold text-rose-600"
                          title={`${dues.unpriced} consumed meal(s) have no price set on their menu, so they add nothing to the total. Set a price on the menu to bill them.`}
                        >
                          {dues.unpriced} unpriced
                        </span>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onClearDues(student.id, student.full_name)}
                        disabled={!canSettle || isClearing}
                        title={
                          canSettle
                            ? `Settle dues (${monthsLabel}) and restore access`
                            : "No outstanding dues"
                        }
                        className="border-emerald-300 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-800 disabled:border-slate-200 disabled:text-slate-300"
                      >
                        {isClearing ? (
                          <>
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            Clearing
                          </>
                        ) : (
                          <>
                            <Wallet className="size-4" aria-hidden="true" />
                            Clear Dues
                          </>
                        )}
                      </Button>
                    </div>
                  </TableCell>

                  <TableCell>
                    <RoleSelect
                      user={student}
                      onRoleChange={onRoleChange}
                      isUpdating={updatingUserIds.includes(student.id)}
                      isSelf={student.id === currentUserId}
                    />
                  </TableCell>
                </TableRow>
              );
            })}

            {!isLoading && !students.length && (
              <TableRow>
                <TableCell colSpan={5} className="h-28 text-center text-sm text-slate-500">
                  No student accounts found.
                </TableCell>
              </TableRow>
            )}

            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="h-28 text-center text-sm text-slate-500">
                  Loading students...
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
