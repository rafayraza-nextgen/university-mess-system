import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarX2, Soup, UsersRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MenuManagement } from "@/pages/admin/MenuManagement";
import { AdminFeedback } from "@/pages/admin/AdminFeedback";
import { StaffOperations } from "@/pages/admin/StaffOperations";
import { StudentDirectory } from "@/pages/admin/StudentDirectory";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, planSettlement, summarizeDuesByStudent } from "@/lib/ledger";
import { cn } from "@/lib/utils";

// Only admins pass the `admins_select_all_users` RLS policy, so this returns
// the full roster rather than just the signed-in profile.
const fetchUsers = async () => {
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, student_id, role, account_status")
    .order("full_name", { ascending: true });

  if (error) {
    return { data: [], error };
  }

  // Normalise the snake_case column to the camelCase the UI passes around.
  return {
    data: (data ?? []).map((user) => ({
      ...user,
      accountStatus: user.account_status || "active",
    })),
    error: null,
  };
};

// Outstanding balances are derived from consumed meals, not read off invoices.
// Nothing in the system raises invoices automatically, so an invoice-only
// balance reads $0.00 for a student who has eaten unpaid meals - which is what
// disabled the Clear Dues button.
//
// Deliberately NOT filtering `.eq('status','consumed')` in SQL. attendance.status
// is constrained to lowercase consumed / opted-out / absent, but the column is
// free text in practice, and a query-time equality filter would silently drop a
// mis-cased row before buildLedgerEntry could normalise it - which shows up as
// one student owing nothing while everyone else looks fine. Rows are filtered in
// JS instead, where the comparison is case- and whitespace-insensitive.
const fetchLedgerDues = async () => {
  const [attendanceResult, invoiceResult] = await Promise.all([
    supabase
      .from("attendance")
      .select("id, student_id, status, menus ( id, date, price )"),
    supabase
      .from("invoices")
      .select("id, student_id, billing_month, total_amount, payment_status"),
  ]);

  if (attendanceResult.error) {
    return { data: {}, error: attendanceResult.error };
  }

  if (invoiceResult.error) {
    return { data: {}, error: invoiceResult.error };
  }

  return {
    data: summarizeDuesByStudent(attendanceResult.data ?? [], invoiceResult.data ?? []),
    error: null,
  };
};

export default function AdminDashboard() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [duesByStudent, setDuesByStudent] = useState({});
  const [duesError, setDuesError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [roleError, setRoleError] = useState("");
  const [updatingUserIds, setUpdatingUserIds] = useState([]);
  const [clearingUserIds, setClearingUserIds] = useState([]);
  const [settlementNotice, setSettlementNotice] = useState("");

  useEffect(() => {
    let active = true;

    const loadUsers = async () => {
      setIsLoading(true);

      const [rosterResult, duesResult] = await Promise.all([fetchUsers(), fetchLedgerDues()]);

      if (!active) return;

      if (rosterResult.error) {
        console.warn("Unable to load user accounts.", rosterResult.error);
        setLoadError("We could not load user accounts. Please refresh to try again.");
      } else {
        setLoadError("");
        setUsers(rosterResult.data);
      }

      if (duesResult.error) {
        // Swallowing this is what made a broken dues query look like a room full
        // of settled accounts: duesByStudent stayed empty and every row rendered
        // a confident $0.00. The failure has to reach the screen, because until
        // now a load error and a zero balance were indistinguishable.
        console.warn("Unable to load outstanding dues.", duesResult.error);
        setDuesError(
          duesResult.error.code === "PGRST100" || duesResult.error.code === "PGRST204"
            ? "Dues could not be read because the attendance/menus join failed. Check the server console."
            : "We could not load outstanding dues. Balances shown may be wrong.",
        );
        setDuesByStudent({});
      } else {
        setDuesError("");
        setDuesByStudent(duesResult.data);
      }

      setIsLoading(false);
    };

    loadUsers();

    return () => {
      active = false;
    };
  }, []);

  // Silent refresh used after an approval or settlement, so the roster updates
  // without flashing the loading skeleton.
  const refreshUsers = useCallback(async () => {
    const { data, error } = await fetchUsers();

    if (error) {
      console.warn("Unable to refresh user accounts.", error);
      return;
    }

    setUsers(data);
  }, []);

  const refreshDues = useCallback(async () => {
    const { data, error } = await fetchLedgerDues();

    if (error) {
      console.warn("Unable to refresh outstanding dues.", error);
      setDuesError("We could not refresh outstanding dues. Balances shown may be wrong.");
      return;
    }

    setDuesError("");
    setDuesByStudent(data);
  }, []);

  // Settles a student's outstanding meals, then lifts a suspension.
  //
  // Payment state lives on invoices, and a meal counts as settled when its
  // billing month has a Paid invoice. So a month is settled by flipping its
  // invoice to Paid - and where no invoice was ever raised, one is created. That
  // second case is the whole point: the balance is derived from meals, so
  // updating invoices alone would clear nothing for a student who ate before
  // anyone billed them, and the button would appear to do nothing.
  //
  // Deliberately does NOT touch attendance. That table records who ate what and
  // is the basis of the student's meal history; its status check only permits
  // consumed / opted-out / absent, so writing 'paid' there is rejected by the
  // database and would erase consumption history if it were not.
  const handleClearDues = async (studentId, studentName) => {
    if (clearingUserIds.includes(studentId)) return;

    setClearingUserIds((current) => [...current, studentId]);
    setSettlementNotice("");
    setRoleError("");

    try {
      const [attendanceResult, invoiceResult] = await Promise.all([
        supabase
          .from("attendance")
          .select("id, student_id, status, menus ( id, date, price )")
          .eq("student_id", studentId),
        supabase
          .from("invoices")
          .select("id, student_id, billing_month, total_amount, payment_status")
          .eq("student_id", studentId),
      ]);

      if (attendanceResult.error || invoiceResult.error) {
        console.warn("Unable to read the student's billing records.", {
          attendance: attendanceResult.error,
          invoices: invoiceResult.error,
        });
        setRoleError("We could not read that student's billing records. Please try again.");
        return;
      }

      const months = planSettlement(
        attendanceResult.data ?? [],
        invoiceResult.data ?? [],
        studentId,
      );

      let settledInvoices = 0;
      let createdInvoices = 0;

      for (const month of months) {
        if (month.invoiceIds.length) {
          // Selecting the rows back matters: PostgREST reports success for a
          // write that RLS filtered out, so a short result means the invoice was
          // not actually settled.
          //
          // total_amount is written as well as payment_status. The balance is
          // consumption minus payments, so an invoice that says "Paid" but is
          // for a different figure than the meals it covers leaves a permanent
          // residue that the admin cannot clear by clicking again.
          const { data, error } = await supabase
            .from("invoices")
            .update({ payment_status: "Paid", total_amount: month.amount })
            .in("id", month.invoiceIds)
            .select("id");

          if (error) {
            console.warn(`Unable to settle ${month.billingMonth}.`, error);
            setRoleError(
              `We could not record the payment for ${month.billingMonth}. Please try again.`,
            );
            return;
          }

          settledInvoices += data?.length ?? 0;
          continue;
        }

        // No invoice was ever raised for this month, so record the payment the
        // admin just collected as a Paid invoice. The canonical YYYY-MM spelling
        // is what the student's own ledger matches against on the next fetch.
        const { data, error } = await supabase
          .from("invoices")
          .insert({
            student_id: studentId,
            billing_month: month.billingMonth,
            total_amount: month.amount,
            payment_status: "Paid",
          })
          .select("id")
          .maybeSingle();

        if (error) {
          console.warn(`Unable to record payment for ${month.billingMonth}.`, error);
          setRoleError(
            `We could not record the payment for ${month.billingMonth}. Please try again.`,
          );
          return;
        }

        if (!data) {
          setRoleError("We could not record the payment. Check your permissions.");
          return;
        }

        createdInvoices += 1;
      }

      // Idempotent for an account that is already active, and selected back so a
      // silently blocked write is reported instead of looking like success.
      const { data: updatedUser, error: userError } = await supabase
        .from("users")
        .update({ account_status: "active" })
        .eq("id", studentId)
        .select("id, account_status")
        .maybeSingle();

      if (userError) {
        console.warn("Unable to reactivate the account.", userError);
        setRoleError("The payment was recorded but the account could not be unblocked.");
        return;
      }

      if (!updatedUser) {
        setRoleError("We could not unblock that account. Check your permissions.");
        return;
      }

      await Promise.all([refreshUsers(), refreshDues()]);

      const parts = [];
      const recorded = settledInvoices + createdInvoices;

      if (recorded > 0) {
        parts.push(
          `Cleared ${formatCurrency(months.reduce((sum, month) => sum + month.amount, 0))} across ${months.length} month${months.length === 1 ? "" : "s"} for ${studentName}.`,
        );
      } else {
        parts.push(`${studentName} has no outstanding meals.`);
      }

      parts.push("Account is active.");
      setSettlementNotice(parts.join(" "));
    } catch (thrown) {
      // Without this the rejection escapes as an unhandled promise: the spinner
      // clears, no notice appears, and the admin concludes nothing was saved.
      console.error("Failed to clear dues.", thrown);
      setRoleError("Failed to clear dues. Please try again.");
    } finally {
      setClearingUserIds((current) => current.filter((id) => id !== studentId));
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    if (updatingUserIds.includes(userId)) return;

    setUpdatingUserIds((currentIds) => [...currentIds, userId]);
    setRoleError("");

    try {
      // Selecting the updated row is required: a PostgREST update that RLS
      // filters out still reports success, so a missing row means the write
      // was rejected and must not be treated as a successful promotion.
      const { data: updatedUser, error } = await supabase
        .from("users")
        .update({ role: newRole })
        .eq("id", userId)
        .select("id, role")
        .maybeSingle();

      if (error) throw error;

      if (!updatedUser) {
        throw new Error("That account was not updated.");
      }

      // Refetch so the row moves between tabs and the summary counts update.
      const { data, error: refetchError } = await fetchUsers();

      if (refetchError) throw refetchError;

      setUsers(data);
    } catch (updateError) {
      console.warn("Unable to update the user role.", updateError);
      setRoleError("We could not update that role. Please try again.");
    } finally {
      setUpdatingUserIds((currentIds) => currentIds.filter((id) => id !== userId));
    }
  };

  const overviewStats = useMemo(() => {
    const studentCount = users.filter((user) => user.role === "student").length;
    const staffCount = users.filter((user) => user.role === "staff").length;
    const adminCount = users.filter((user) => user.role === "admin").length;

    return [
      {
        title: "Active Students",
        value: isLoading ? "..." : String(studentCount),
        detail: isLoading
          ? "Loading accounts"
          : `${staffCount} staff · ${adminCount} admin${adminCount === 1 ? "" : "s"}`,
        icon: UsersRound,
        color: "bg-blue-50 text-blue-600",
      },
      {
        // TODO: derive from attendance rows joined to today's menus.
        title: "Meals Served Today",
        value: "—",
        detail: "Not tracked yet",
        icon: Soup,
        color: "bg-emerald-50 text-emerald-600",
      },
      {
        // TODO: derive from attendance rows with an opted-out status.
        title: "Pending Opt-Outs",
        value: "—",
        detail: "Not tracked yet",
        icon: CalendarX2,
        color: "bg-amber-50 text-amber-600",
      },
    ];
  }, [users, isLoading]);

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-8">
      <div className="w-full">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Admin Dashboard</h1>
        <p className="mt-2 text-slate-600">
          Manage menus, students, and cafeteria operations from one control center.
        </p>
      </div>

      {(loadError || roleError) && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError || roleError}
        </div>
      )}

      {settlementNotice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
        >
          {settlementNotice}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3 w-full">
        {overviewStats.map((stat) => {
          const Icon = stat.icon;

          return (
            <Card key={stat.title} className="border-slate-200 shadow-sm">
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardDescription>{stat.title}</CardDescription>
                  <CardTitle className="mt-2 text-3xl">{stat.value}</CardTitle>
                </div>
                <div className={cn("grid size-10 place-items-center rounded-xl", stat.color)}>
                  <Icon className="size-5" aria-hidden="true" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500">{stat.detail}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs className="w-full space-y-4" defaultValue="menus">
        <TabsList className="inline-flex h-10 items-center justify-start rounded-md bg-slate-100 p-1">
          <TabsTrigger value="menus">Menu Management</TabsTrigger>
          <TabsTrigger value="students">Student Directory</TabsTrigger>
          <TabsTrigger value="staff">Staff Operations</TabsTrigger>
          <TabsTrigger value="feedback">Student Reviews</TabsTrigger>
        </TabsList>

        <TabsContent value="menus" className="w-full">
          <MenuManagement />
        </TabsContent>

        <TabsContent value="feedback" className="w-full">
          <AdminFeedback />
        </TabsContent>

        <TabsContent value="students" className="w-full">
          <StudentDirectory
            users={users}
            duesByStudent={duesByStudent}
            onRoleChange={handleRoleChange}
            onClearDues={handleClearDues}
            duesError={duesError}
            clearingUserIds={clearingUserIds}
            updatingUserIds={updatingUserIds}
            isLoading={isLoading}
            currentUserId={currentUser?.id}
          />
        </TabsContent>

        <TabsContent value="staff" className="w-full">
          <StaffOperations
            users={users}
            onRoleChange={handleRoleChange}
            onRefreshUsers={refreshUsers}
            updatingUserIds={updatingUserIds}
            isLoading={isLoading}
            currentUserId={currentUser?.id}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
