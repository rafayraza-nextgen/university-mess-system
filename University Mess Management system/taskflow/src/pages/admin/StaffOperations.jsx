import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, UserRoundPlus, XCircle } from "lucide-react";
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
import { RoleBadge, RoleSelect } from "@/pages/admin/RoleSelect";
import { supabase } from "@/lib/supabase";

export function StaffOperations({
  users,
  onRoleChange,
  onRefreshUsers,
  updatingUserIds,
  isLoading,
  currentUserId,
}) {
  const [isDeciding, setIsDeciding] = useState(null);
  const [decisionError, setDecisionError] = useState("");

  // Pending applicants are surfaced separately from the approved roster so an
  // approver sees the queue at a glance and the two lists never overlap.
  const pendingApplicants = useMemo(
    () => users.filter((user) => user.role === "staff" && user.accountStatus === "pending"),
    [users],
  );

  const activeStaff = useMemo(
    () => users.filter((user) => user.role === "staff" && user.accountStatus === "active"),
    [users],
  );

  const decide = async (userId, accountStatus) => {
    if (isDeciding) return;

    setIsDeciding(userId);
    setDecisionError("");

    try {
      // Selecting the row back matters: PostgREST reports success for a write
      // that RLS filtered out, so an empty result means it never landed.
      const { data: updated, error } = await supabase
        .from("users")
        .update({ account_status: accountStatus })
        .eq("id", userId)
        .select("id, account_status")
        .maybeSingle();

      if (error) {
        console.warn("Unable to update the staff application.", error);
        setDecisionError("We could not update that application. Please try again.");
        return;
      }

      if (!updated) {
        setDecisionError("That application could not be updated. Check your permissions.");
        return;
      }

      // Pull the roster again so this panel and the approved table both update.
      await onRefreshUsers();
    } finally {
      setIsDeciding(null);
    }
  };

  return (
    <div className="w-full space-y-4">
      <Card className="w-full border-amber-200 bg-amber-50/40 shadow-sm">
        <CardHeader className="border-b border-amber-200">
          <CardTitle className="flex items-center gap-2">
            <UserRoundPlus className="size-5 text-amber-600" /> Pending Staff Approvals
          </CardTitle>
          <CardDescription>
            {isLoading
              ? "Loading staff applications..."
              : `${pendingApplicants.length} application${pendingApplicants.length === 1 ? "" : "s"} awaiting review. An approved applicant can sign in immediately.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          {decisionError && (
            <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {decisionError}
            </div>
          )}

          {pendingApplicants.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Staff ID</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingApplicants.map((applicant) => (
                  <TableRow key={applicant.id}>
                    <TableCell className="font-semibold text-slate-900">
                      {applicant.full_name}
                    </TableCell>
                    <TableCell className="font-medium text-slate-600">
                      {applicant.student_id || "—"}
                    </TableCell>
                    <TableCell className="text-slate-600">{applicant.email}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {isDeciding === applicant.id && (
                          <Loader2 className="size-4 animate-spin text-slate-400" aria-hidden="true" />
                        )}
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => decide(applicant.id, "active")}
                          disabled={Boolean(isDeciding)}
                          className="bg-blue-600 text-white hover:bg-blue-700"
                        >
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                          Approve
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => decide(applicant.id, "rejected")}
                          disabled={Boolean(isDeciding)}
                          className="text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                        >
                          <XCircle className="size-4" aria-hidden="true" />
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-6 py-10 text-center text-sm text-slate-500">
              {isLoading ? "Loading applications..." : "No staff applications are waiting for review."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="w-full border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-200">
          <CardTitle>Staff Operations</CardTitle>
          <CardDescription>
            {isLoading
              ? "Loading staff accounts..."
              : `${activeStaff.length} approved cafeteria staff account${activeStaff.length === 1 ? "" : "s"}. Scanner metrics are not tracked yet.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Staff ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeStaff.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-semibold text-slate-900">
                    {member.full_name}
                  </TableCell>
                  <TableCell className="text-slate-600">{member.email}</TableCell>
                  <TableCell className="font-medium text-slate-600">
                    {member.student_id || "—"}
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={member.role} />
                  </TableCell>
                  <TableCell>
                    <RoleSelect
                      user={member}
                      onRoleChange={onRoleChange}
                      isUpdating={updatingUserIds.includes(member.id)}
                      isSelf={member.id === currentUserId}
                    />
                  </TableCell>
                </TableRow>
              ))}

              {!isLoading && !activeStaff.length && (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-sm text-slate-500">
                    No approved staff accounts yet.
                  </TableCell>
                </TableRow>
              )}

              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-sm text-slate-500">
                    Loading staff...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
