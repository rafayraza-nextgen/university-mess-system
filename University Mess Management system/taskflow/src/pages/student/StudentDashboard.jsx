import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  QrCode as QrCodeIcon,
  ReceiptText,
  Star,
  Utensils,
  X,
} from "lucide-react";
import QRCode from "react-qr-code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import {
  formatDateKey,
  getLocalDateKey,
  getMillisecondsUntilNextMidnight,
  getPastDayLabel,
  getUpcomingDayLabel,
} from "@/lib/date";
import { supabase } from "@/lib/supabase";
import {
  buildLedger,
  normalizeAttendanceStatus,
  readEmbeddedMenu,
  totalConsumed,
  totalPaidFor,
} from "@/lib/ledger";
import { cn } from "@/lib/utils";

const MEAL_ORDER = {
  Breakfast: 0,
  Lunch: 1,
  Dinner: 2,
};

// A Postgres `time` column arrives as a bare "HH:MM:SS" with no zone, so it is
// formatted by reconstructing a local wall-clock date rather than handing the
// string to `new Date`, which would either parse it as UTC or fail outright.
// 2026-09-28 is only a carrier for the time of day.
const formatClockTime = (timeString) => {
  const [hour, minute] = String(timeString ?? "").split(":").map(Number);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(2026, 8, 28, hour, minute),
  );
};

// The service window published by the admin. Both ends are optional, so a menu
// with only a start time must not render a dangling dash, and a menu with neither
// returns "" so callers can say so rather than print a blank.
const formatServiceWindow = (startTime, endTime) => {
  const start = formatClockTime(startTime);
  const end = formatClockTime(endTime);

  if (start && end) return `${start} – ${end}`;
  return start ?? end ?? "";
};

const UNPUBLISHED_TIME = "time not published";

// Swap this to "INR" if the mess bills in rupees.
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Billing always reflects the price stored on each menu row, never a flat rate
// assumed in the client. A meal with no price renders as unpriced rather than
// as a misleading $0.00.
const formatCurrency = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  return currencyFormatter.format(Number(value));
};

// `date` is a Postgres date column, so it is parsed and compared in local time
// via the helpers in @/lib/date. Never route these through UTC.

// Postgres returns `date` as YYYY-MM-DD and `time` as HH:MM:SS, with no zone.
// Building the Date from the parts keeps it unambiguously local, which is the
// right frame for a cutoff expressed as a wall-clock time at the mess. This
// also avoids the template-string form, where a bare date is parsed as UTC and
// can shift the comparison by a day.
const toMealMoment = (dateKey, timeString) => {
  if (!dateKey) {
    return null;
  }

  const [year, month, day] = String(dateKey).split("-").map(Number);
  const [hour, minute, second] = String(timeString ?? "00:00:00").split(":").map(Number);

  return new Date(
    year,
    (month || 1) - 1,
    day || 1,
    Number.isFinite(hour) ? hour : 0,
    Number.isFinite(minute) ? minute : 0,
    Number.isFinite(second) ? second : 0,
  );
};

const mapMenuRow = (row, todayKey) => ({
  id: row.id,
  date: row.date,
  type: row.meal_type,
  dish: row.main_dish,
  status: row.status,
  // The admin publishes the window per menu, so the display and the opt-out
  // cutoff below read the same stored values.
  time: formatServiceWindow(row.start_time, row.end_time),
  startTime: row.start_time ?? null,
  endTime: row.end_time ?? null,
  day: getUpcomingDayLabel(row.date, todayKey),
  displayDate: formatDateKey(row.date, { month: "short", day: "numeric" }),
});

const sortMenus = (first, second) =>
  first.date.localeCompare(second.date) ||
  (MEAL_ORDER[first.type] ?? 99) - (MEAL_ORDER[second.type] ?? 99);

const mapConsumedRow = (row, todayKey) => {
  const menu = readEmbeddedMenu(row);

  return {
    id: row.id,
    menuId: row.menu_id,
    date: menu.date,
    meal: menu.meal_type,
    dish: menu.main_dish,
    time: formatServiceWindow(menu.start_time, menu.end_time),
    // Carried through for recency ordering: three meals on one date share a date
    // string, so the published start time is what separates them.
    startTime: menu.start_time ?? null,
    day: getPastDayLabel(menu.date, todayKey),
    displayDate: formatDateKey(menu.date, { month: "short", day: "numeric" }),
  };
};

// Published menus from today onwards, ordered by date then meal type.
const fetchUpcomingMenus = async (todayKey) => {
  const { data, error } = await supabase
    .from("menus")
    .select("*")
    .eq("status", "Published")
    .gte("date", todayKey)
    .order("date", { ascending: true });

  return { data: data ?? [], error };
};

// The student's own attendance rows. `menus(...)` is embedded so the recent
// meals list and the billing ledger can show the dish name, its actual price and
// its service window without a second round trip. start_time / end_time must be
// requested explicitly: an embed returns only the columns named, so a row that
// omits them would render a blank time rather than fall back to anything.
const fetchAttendance = async (studentId) => {
  const { data, error } = await supabase
    .from("attendance")
    .select(
      "*, menus ( id, date, meal_type, main_dish, price, start_time, end_time )",
    )
    .eq("student_id", studentId);

  return { data: data ?? [], error };
};

// Only the student's own invoices are readable under RLS. billing_month is
// stored as text, so descending order is chronological only while admins
// write zero-padded values such as "2026-08".
const fetchInvoices = async (studentId) => {
  const { data, error } = await supabase
    .from("invoices")
    // student_id must be in the projection even though the .eq() already scopes
    // the query: totalPaidFor() re-matches each invoice against the student id
    // to keep it from summing someone else's payments. Without the column the
    // guard sees undefined and silently totals zero - the invoices still render
    // in the table, because the table only reads the other three fields.
    .select("id, student_id, billing_month, total_amount, payment_status")
    .eq("student_id", studentId)
    .order("billing_month", { ascending: false });

  return { data: data ?? [], error };
};

function ListSkeleton({ rows = 3 }) {
  return (
    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 p-4">
          <div className="size-11 shrink-0 animate-pulse rounded-lg bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-44 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="h-8 w-24 animate-pulse rounded-lg bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <Utensils className="mx-auto size-6 text-slate-300" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-slate-500">{message}</p>
    </div>
  );
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const [upcomingMenus, setUpcomingMenus] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [pendingMenuIds, setPendingMenuIds] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [menuError, setMenuError] = useState("");
  const [attendanceError, setAttendanceError] = useState("");
  const [invoiceError, setInvoiceError] = useState("");
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState("");
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [selectedMealForFeedback, setSelectedMealForFeedback] = useState(null);
  const [starRating, setStarRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [submittedFeedback, setSubmittedFeedback] = useState({});
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");

  // Local calendar day, kept in state so it can be rolled forward at midnight
  // instead of being frozen at the moment the page first rendered.
  const [todayKey, setTodayKey] = useState(() => getLocalDateKey());
  const [now, setNow] = useState(() => new Date());
  const [currentDate, setCurrentDate] = useState(() =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date()),
  );

  // Roll the dashboard over the moment the local day changes, and re-check
  // when a tab that was left open overnight becomes visible again.
  useEffect(() => {
    let timeoutId;

    const syncLocalDay = () => {
      const nextLocalDay = getLocalDateKey();

      setTodayKey(nextLocalDay);
      setCurrentDate(
        new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        }).format(new Date()),
      );

      timeoutId = window.setTimeout(syncLocalDay, getMillisecondsUntilNextMidnight() + 1000);
    };

    syncLocalDay();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timeoutId);
        syncLocalDay();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // The opt-out cutoff is a wall-clock moment, so a page rendered before a meal
  // starts would otherwise keep offering the button after service began. A
  // short tick keeps the lock state current without a full refetch.
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 30 * 1000);

    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    let active = true;
    const studentId = user?.id;

    const loadDashboardData = async () => {
      setIsLoading(true);

      const [menusResult, attendanceResult, invoicesResult] = await Promise.all([
        fetchUpcomingMenus(todayKey),
        studentId
          ? fetchAttendance(studentId)
          : Promise.resolve({ data: [], error: null }),
        studentId
          ? fetchInvoices(studentId)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!active) return;

      if (menusResult.error) {
        console.warn("Unable to load the published menu.", menusResult.error);
        setMenuError("We could not load the menu right now. Please refresh to try again.");
      } else {
        setMenuError("");
        setUpcomingMenus(menusResult.data.map((row) => mapMenuRow(row, todayKey)).sort(sortMenus));
      }

      if (attendanceResult.error) {
        console.warn("Unable to load your attendance records.", attendanceResult.error);
        setAttendanceError(
          "We could not load your meal selections. Please refresh to try again.",
        );
      } else {
        setAttendanceError("");
        setAttendance(attendanceResult.data);
      }

      if (invoicesResult.error) {
        console.warn("Unable to load your invoices.", invoicesResult.error);
        setInvoiceError("We could not load your invoices. Please refresh to try again.");
      } else {
        setInvoiceError("");
        setInvoices(invoicesResult.data);
      }

      setIsLoading(false);
    };

    loadDashboardData();

    return () => {
      active = false;
    };
  }, [user?.id, todayKey]);

  // The attendance table is the single source of truth for the dashboard
  // statistics and the opt-in / opt-out buttons.
  const consumedRecords = useMemo(
    () => attendance.filter((record) => record.status === "consumed"),
    [attendance],
  );

  // The itemised ledger, newest meal first. Built by the shared helper so the
  // admin directory and this view can never derive different balances.
  const ledger = useMemo(() => buildLedger(attendance), [attendance]);

  // Balance = everything eaten, less everything paid. Consumption comes from
  // attendance joined to menu prices; payments come from Paid invoices. The two
  // are fetched separately because neither table can answer the other.
  const consumedTotal = useMemo(() => totalConsumed(ledger), [ledger]);
  const paidTotal = useMemo(() => totalPaidFor(invoices, user?.id), [invoices, user?.id]);
  const ledgerUnpaidTotal = consumedTotal - paidTotal;

  const consumedMealCount = useMemo(
    () => ledger.filter((entry) => entry.counts).length,
    [ledger],
  );

  // Consumed meals, newest first.
  //
  // The date bound is inclusive. It used to be `menu.date < todayKey`, which
  // silently hid every meal eaten today - the exact meal a student is most
  // likely to want to review or rate - and left the section reading "No
  // completed meals to review yet." next to a billing ledger full of them.
  //
  // Future dates are still excluded, so a mis-published menu cannot appear here.
  const recentMeals = useMemo(
    () =>
      attendance
        .filter((record) => {
          const menu = readEmbeddedMenu(record);

          return (
            normalizeAttendanceStatus(record.status) === "consumed" &&
            menu &&
            menu.date <= todayKey
          );
        })
        .map((record) => mapConsumedRow(record, todayKey))
        .sort(
          (first, second) =>
            // Date first, then the published service time. Three meals on one
            // date all share the same date string, so ordering on the date alone
            // left the order within a day arbitrary and the newest meal was not
            // reliably at the top.
            second.date.localeCompare(first.date) ||
            String(second.startTime ?? "").localeCompare(String(first.startTime ?? "")),
        )
        .slice(0, 3),
    [attendance, todayKey],
  );

  const nextMeal = upcomingMenus[0] ?? null;

  const handleMealToggle = async (menuId, action) => {
    const studentId = user?.id;

    if (!studentId || pendingMenuIds.includes(menuId)) {
      return;
    }

    setPendingMenuIds((currentIds) => [...currentIds, menuId]);
    setAttendanceError("");

    try {
      if (action === "opt-out") {
        const { error } = await supabase
          .from("attendance")
          .insert({ student_id: studentId, menu_id: menuId, status: "opted-out" });

        if (error) {
          // 23505 means a row already exists for this meal, which happens when
          // staff has already recorded the student as absent or consumed. The
          // attendance_student_menu_key unique constraint rejects the insert,
          // so flip the existing row instead.
          if (error.code === "23505") {
            const { error: updateError } = await supabase
              .from("attendance")
              .update({ status: "opted-out" })
              .match({ student_id: studentId, menu_id: menuId });

            if (updateError) throw updateError;
          } else {
            throw error;
          }
        }
      } else if (action === "opt-in") {
        // Scoped to the opt-out status so a consumed or absent record written
        // by staff can never be deleted by this button. Selecting the removed
        // row matters: a delete that RLS filters out still reports success,
        // so an empty result means the opt-out was never actually cleared.
        const { data: deletedRows, error } = await supabase
          .from("attendance")
          .delete()
          .match({ student_id: studentId, menu_id: menuId, status: "opted-out" })
          .select("id");

        if (error) throw error;

        if (!deletedRows || deletedRows.length === 0) {
          throw new Error("No opt-out record was found to remove.");
        }
      }

      // Refetch immediately so the button reflects the stored state.
      const { data, error } = await fetchAttendance(studentId);

      if (error) throw error;

      setAttendance(data);
    } catch (toggleError) {
      console.error("Failed to save the meal selection.", {
        menuId,
        action,
        error: toggleError,
      });
      setAttendanceError("We could not save your meal selection. Please try again.");
    } finally {
      setPendingMenuIds((currentIds) => currentIds.filter((id) => id !== menuId));
    }
  };

  const stats = [
    {
      title: "Next Meal",
      value: isLoading
        ? "Loading..."
        : nextMeal
          ? `${nextMeal.type} - ${nextMeal.dish}`
          : "No upcoming meals",
      detail: isLoading
        ? "Fetching the published menu"
        : nextMeal
          ? nextMeal.time
            ? `${nextMeal.day} at ${nextMeal.time}`
            : `${nextMeal.day} - ${UNPUBLISHED_TIME}`
          : "Nothing scheduled",
      isPending: isLoading,
      icon: Utensils,
      color: "bg-blue-50 text-blue-600",
    },
    {
      title: "Meals Consumed",
      value: isLoading ? "Loading..." : String(consumedRecords.length),
      detail: isLoading ? "Loading your records" : "All recorded meals",
      isPending: isLoading,
      icon: CalendarDays,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      title: "Amount Due",
      value: isLoading ? "Loading..." : formatCurrency(ledgerUnpaidTotal),
      detail: isLoading
        ? "Loading your meals"
        : consumedMealCount
          ? `${formatCurrency(consumedTotal)} eaten, ${formatCurrency(paidTotal)} paid`
          : "Nothing outstanding",
      isPending: isLoading,
      icon: ReceiptText,
      color: "bg-amber-50 text-amber-600",
    },
  ];

  // The scanner reads this JSON. The nonce makes each pass distinct so the
  // same code cannot be replayed for a second meal, and the scanner can reject
  // a nonce it has already accepted.
  const handleGenerateQR = () => {
    const payload = JSON.stringify({
      student_id: user?.id,
      timestamp: new Date().toISOString(),
      nonce: crypto.randomUUID(),
    });

    setQrData(payload);
    setShowQR(true);
  };

  const openFeedbackDialog = (meal) => {
    const previousFeedback = submittedFeedback[meal.id];

    setSelectedMealForFeedback(meal);
    setStarRating(previousFeedback?.rating || 0);
    setFeedbackText(previousFeedback?.text || "");
    setIsFeedbackOpen(true);
  };

  const resetFeedbackForm = () => {
    setSelectedMealForFeedback(null);
    setStarRating(0);
    setFeedbackText("");
    // Cleared on close so a failed save does not greet the student on reopen.
    setFeedbackError("");
  };

  const closeFeedbackDialog = () => {
    setIsFeedbackOpen(false);
    resetFeedbackForm();
  };

  const handleFeedbackDialogChange = (open) => {
    if (open) return;
    closeFeedbackDialog();
  };

  // Persists the review. Previously this only wrote to React state, so a review
  // disappeared on refresh and no administrator could ever read it.
  const submitFeedback = async (event) => {
    event.preventDefault();

    const studentId = user?.id;
    const meal = selectedMealForFeedback;

    if (!meal || !studentId || !starRating || !feedbackText.trim() || isSavingFeedback) {
      return;
    }

    setIsSavingFeedback(true);
    setFeedbackError("");

    try {
      // Keyed on (student_id, menu_id) composite unique constraint, so re-rating a meal
      // replaces the review rather than filing a second one.
      const { error: feedbackError } = await supabase
        .from("meal_feedback")
        .upsert(
          {
            student_id: studentId,
            menu_id: meal.menuId,
            rating: starRating,
            comment: feedbackText.trim(),
          },
          { onConflict: "student_id,menu_id" },
        )
        .select("id")
        .maybeSingle();

      if (feedbackError) {
        console.warn("Unable to save the meal review.", feedbackError);
        setFeedbackError("Failed to save: " + (feedbackError.message || "Unknown error"));
        return;
      }

      setSubmittedFeedback((currentFeedback) => ({
        ...currentFeedback,
        [meal.id]: {
          rating: starRating,
          text: feedbackText.trim(),
        },
      }));

      closeFeedbackDialog();
    } catch (thrown) {
      // Without this the rejection escapes unhandled and the dialog looks frozen.
      console.error("Failed to submit the meal review.", thrown);
      setFeedbackError("Failed to save: " + (thrown?.message || "Unknown error"));
    } finally {
      setIsSavingFeedback(false);
    }
  };

  const downloadInvoice = (invoice) => {
    const invoiceContent = [
      "University Mess",
      `Billing Month: ${invoice.billing_month}`,
      `Amount: ${formatCurrency(invoice.total_amount)}`,
      `Status: ${invoice.payment_status}`,
    ].join("\n");
    const file = new Blob([invoiceContent], { type: "text/plain" });
    const fileUrl = URL.createObjectURL(file);
    const downloadLink = document.createElement("a");

    downloadLink.href = fileUrl;
    downloadLink.download = `university-mess-${invoice.billing_month}-invoice.txt`;
    downloadLink.click();
    URL.revokeObjectURL(fileUrl);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <p className="text-sm font-medium text-slate-500">{currentDate}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
          Welcome, {user?.name}
        </h1>
        <p className="mt-2 text-slate-600">Here is your meal plan and billing summary for this month.</p>
      </div>

      {menuError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {menuError}
        </div>
      )}

      {attendanceError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {attendanceError}
        </div>
      )}

      {invoiceError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {invoiceError}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;

          return (
            <Card key={stat.title} className="border-slate-200 shadow-sm">
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardDescription>{stat.title}</CardDescription>
                  <CardTitle className={cn("mt-2 text-lg", stat.isPending && "animate-pulse")}>
                    {stat.value}
                  </CardTitle>
                </div>
                <div className={cn("grid size-10 place-items-center rounded-xl", stat.color)}>
                  <Icon className="size-5" aria-hidden="true" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="flex items-center gap-1.5 text-sm text-slate-500">
                  {stat.isPending ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      {stat.detail}
                    </>
                  ) : (
                    stat.detail
                  )}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Card className="border-blue-200 bg-blue-600 text-white shadow-md">
        <CardContent className="flex flex-col items-start justify-between gap-5 p-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/15">
              <QrCodeIcon className="size-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Your meal QR code</h2>
              <p className="mt-1 text-sm text-blue-100">Generate a fresh pass before entering the mess.</p>
            </div>
          </div>

          {showQR ? (
            <div className="flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row sm:items-start">
              <div className="rounded-2xl bg-white p-3 shadow-sm">
                <QRCode
                  value={qrData}
                  size={132}
                  bgColor="#ffffff"
                  fgColor="#0f172a"
                  className="h-auto max-w-full"
                  aria-label="Your meal entry QR code"
                />
              </div>

              <div className="flex flex-col items-center gap-2.5 sm:items-start">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Check className="size-4" aria-hidden="true" /> Meal QR Ready
                </p>
                <p className="max-w-44 text-center text-xs leading-5 text-blue-100 sm:text-left">
                  Show this at the counter. A new pass replaces the previous one.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleGenerateQR}
                    className="h-9 bg-white px-3 text-xs text-blue-700 hover:bg-white/90"
                  >
                    <QrCodeIcon className="size-3.5" aria-hidden="true" /> Regenerate
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowQR(false)}
                    className="flex items-center gap-2 rounded-full border border-white bg-transparent px-4 py-2 text-white transition-colors hover:bg-white/10"
                  >
                    <X className="size-3.5" aria-hidden="true" /> Hide
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={handleGenerateQR}
              className="w-full bg-white text-blue-700 hover:bg-white/90 sm:w-auto"
            >
              <QrCodeIcon className="size-4" aria-hidden="true" /> Generate Meal QR Code
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Upcoming Menu</CardTitle>
          <CardDescription>
            Published meals from today onwards. Opt out before the cutoff to skip a meal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ListSkeleton />
          ) : upcomingMenus.length > 0 ? (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {upcomingMenus.map((menu) => {
                const isOptedOut = attendance.some(
                  (record) => record.menu_id === menu.id && record.status === "opted-out",
                );
                const isConsumed = attendance.some(
                  (record) => record.menu_id === menu.id && record.status === "consumed",
                );
                const isPending = pendingMenuIds.includes(menu.id);

                // Opt-out stays open for the whole service window, so a student
                // can still skip a meal that is currently being served. The lock
                // lands once the window closes: end_time when the admin set one,
                // otherwise the start time, otherwise the end of that day.
                const closesAt =
                  toMealMoment(menu.date, menu.endTime) ??
                  toMealMoment(menu.date, menu.startTime) ??
                  toMealMoment(menu.date, "23:59:59");
                const isLocked = !closesAt || now >= closesAt;

                const lockReason = menu.endTime
                  ? `Service ran until ${String(menu.endTime).slice(0, 5)}; the opt-out cutoff has passed.`
                  : menu.startTime
                    ? `Service started at ${String(menu.startTime).slice(0, 5)} and no end time is published, so the cutoff is the start time.`
                    : "This meal has no published service window yet.";

                return (
                  <div
                    key={menu.id}
                    className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                        <Utensils className="size-5" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{menu.type}</p>
                        <p className="text-sm text-slate-500">{menu.dish}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <div className="text-left sm:text-right">
                        <p className="text-sm font-medium text-slate-800">{menu.day}</p>
                        <p className="flex items-center gap-1 text-xs text-slate-500 sm:justify-end">
                          <Clock3 className="size-3.5" /> {menu.displayDate}
                          {menu.time ? ` at ${menu.time}` : ` - ${UNPUBLISHED_TIME}`}
                        </p>
                      </div>
                      {isLocked && !isConsumed && !isOptedOut ? (
                        <span
                          title={lockReason}
                          className="inline-flex min-w-24 items-center justify-center rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400"
                        >
                          Locked
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant={isOptedOut ? "default" : "destructive"}
                          onClick={() =>
                            handleMealToggle(menu.id, isOptedOut ? "opt-in" : "opt-out")
                          }
                          disabled={isPending || isConsumed}
                          aria-busy={isPending}
                          className={cn(
                            "min-w-24",
                            isOptedOut && "bg-blue-600 text-white hover:bg-blue-700",
                            isConsumed && "bg-emerald-600 text-white hover:bg-emerald-600",
                          )}
                        >
                          {isPending ? (
                            <>
                              <Loader2 className="size-4 animate-spin" /> Saving
                            </>
                          ) : isConsumed ? (
                            "Consumed"
                          ) : isOptedOut ? (
                            "Opt-In"
                          ) : (
                            "Opt-Out"
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No upcoming meals scheduled." />
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Recent Meals</CardTitle>
          <CardDescription>Rate your recent dining experiences.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ListSkeleton />
          ) : recentMeals.length > 0 ? (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {recentMeals.map((meal) => {
                const savedFeedback = submittedFeedback[meal.id];

                return (
                  <div
                    key={meal.id}
                    className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                        <CheckCircle2 className="size-5" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">
                            {meal.meal} - {meal.dish}
                          </p>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            Completed
                          </span>
                        </div>
                        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                          <Clock3 className="size-3.5" /> {meal.day}, {meal.displayDate}
                          {meal.time ? ` at ${meal.time}` : ` - ${UNPUBLISHED_TIME}`}
                        </p>
                        {savedFeedback && (
                          <div
                            className="mt-1.5 flex items-center gap-1"
                            aria-label={`${savedFeedback.rating} out of 5 stars`}
                          >
                            {Array.from({ length: 5 }).map((_, index) => (
                              <Star
                                key={index}
                                className={cn(
                                  "size-3.5",
                                  index < savedFeedback.rating
                                    ? "fill-amber-400 text-amber-400"
                                    : "text-slate-200",
                                )}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openFeedbackDialog(meal)}
                      className="w-full sm:w-auto"
                    >
                      <Star className="size-4" />
                      {savedFeedback ? "Edit Feedback" : "Leave Feedback"}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No completed meals to review yet." />
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Billing & Invoices</CardTitle>
          <CardDescription>
            View your current balance and past meal invoices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-white">
                <ReceiptText className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600">Amount Due</p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">
                  {isLoading ? "—" : formatCurrency(ledgerUnpaidTotal)}
                </p>
              </div>
            </div>
            <p className="max-w-56 text-xs font-medium text-slate-500 sm:text-right">
              {consumedMealCount
                ? `${formatCurrency(consumedTotal)} of meals eaten, less ${formatCurrency(paidTotal)} already paid.`
                : "No meals have been charged to your account yet."}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-semibold text-slate-800">
                      {invoice.billing_month}
                    </TableCell>
                    <TableCell className="font-bold text-slate-900">
                      {formatCurrency(invoice.total_amount)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "hover:bg-transparent",
                          invoice.payment_status === "Paid"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800",
                        )}
                      >
                        {invoice.payment_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadInvoice(invoice)}
                        aria-label={`Download ${invoice.billing_month} invoice`}
                        title={`Download ${invoice.billing_month} invoice`}
                        className="text-slate-600 hover:bg-slate-100 hover:text-blue-600"
                      >
                        <Download className="size-4" />
                        <span className="hidden sm:inline">Download</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}

                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-sm text-slate-500">
                      Loading invoices...
                    </TableCell>
                  </TableRow>
                ) : (
                  !invoices.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-sm text-slate-500">
                        No past invoices available.
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Billing Ledger</CardTitle>
            <CardDescription>
              Every recorded meal with the price charged for it.
            </CardDescription>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {isLoading ? "..." : `${ledger.length} entries`}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="min-w-[520px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Meal</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.slice(0, 25).map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap font-medium text-slate-700">
                    {formatDateKey(entry.date, { month: "short", day: "numeric", year: "numeric" })}
                  </TableCell>
                  <TableCell>
                    <span className="block font-semibold text-slate-900">{entry.mealType}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {entry.mainDish}
                    </span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-semibold",
                      entry.price === null ? "text-slate-400" : "text-slate-900",
                    )}
                  >
                    {formatCurrency(entry.price)}
                  </TableCell>
                  <TableCell className="text-center">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-1 text-xs font-semibold",
                        entry.variant === "emerald" && "bg-emerald-50 text-emerald-700",
                        entry.variant === "amber" && "bg-amber-50 text-amber-700",
                        entry.variant === "slate" && "bg-slate-100 text-slate-600",
                      )}
                    >
                      {entry.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}

              {isLoading && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-sm text-slate-500">
                    Loading your ledger...
                  </TableCell>
                </TableRow>
              )}

              {!isLoading && !ledger.length && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-sm text-slate-500">
                    No meals have been recorded for you yet.
                  </TableCell>
                </TableRow>
              )}

              {ledger.length > 0 && (
                <>
                  <TableRow className="bg-slate-50">
                    <TableCell colSpan={2} className="font-semibold text-slate-900">
                      Total meals eaten
                    </TableCell>
                    <TableCell className="text-right font-bold text-slate-700">
                      {formatCurrency(consumedTotal)}
                    </TableCell>
                    <TableCell className="text-center text-xs font-medium text-slate-500">
                      {consumedMealCount} meal(s)
                    </TableCell>
                  </TableRow>

                  <TableRow className="bg-slate-50">
                    <TableCell colSpan={2} className="font-semibold text-slate-900">
                      Payments received
                    </TableCell>
                    <TableCell className="text-right font-bold text-emerald-700">
                      &minus;{formatCurrency(paidTotal)}
                    </TableCell>
                    <TableCell className="text-center text-xs font-medium text-slate-500">
                      from paid invoices
                    </TableCell>
                  </TableRow>

                  <TableRow className="bg-amber-50">
                    <TableCell colSpan={2} className="font-extrabold text-slate-900">
                      Amount due
                    </TableCell>
                    <TableCell className="text-right font-extrabold text-amber-700">
                      {formatCurrency(ledgerUnpaidTotal)}
                    </TableCell>
                    <TableCell className="text-center text-xs font-medium text-slate-500">
                      {ledgerUnpaidTotal < 0 ? "in credit" : "balance"}
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>

          {ledger.length > 25 && (
            <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              Showing the 25 most recent entries out of {ledger.length}.
            </p>
          )}

        </CardContent>
      </Card>

      <Dialog open={isFeedbackOpen} onOpenChange={handleFeedbackDialogChange}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitFeedback}>
            <DialogHeader>
              <DialogTitle>Rate your meal</DialogTitle>
              <DialogDescription>
                {selectedMealForFeedback
                  ? `${selectedMealForFeedback.meal} - ${selectedMealForFeedback.dish}`
                  : "Share your dining experience"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-5">
              <div className="space-y-2 text-center">
                <p className="text-sm font-medium text-slate-700">How was your meal?</p>
                <div
                  className="flex items-center justify-center gap-1"
                  role="radiogroup"
                  aria-label="Meal rating"
                >
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      role="radio"
                      aria-checked={starRating === star}
                      aria-label={`${star} star${star > 1 ? "s" : ""}`}
                      onClick={() => setStarRating(star)}
                      className="rounded-lg p-1 transition-transform duration-150 hover:scale-110 focus:outline-none focus:ring-2 focus:ring-amber-200"
                    >
                      <Star
                        className={cn(
                          "size-8 transition-colors duration-150",
                          star <= starRating
                            ? "fill-amber-400 text-amber-400"
                            : "text-slate-300",
                        )}
                      />
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  {starRating > 0 ? `${starRating} out of 5` : "Select a rating"}
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="meal-feedback" className="text-sm font-medium text-slate-700">
                  Written Feedback
                </label>
                <Textarea
                  id="meal-feedback"
                  required
                  rows={4}
                  maxLength={500}
                  value={feedbackText}
                  onChange={(event) => setFeedbackText(event.target.value)}
                  placeholder="Tell us what you thought..."
                />
                <p className="text-right text-xs text-slate-400">
                  {feedbackText.length}/500
                </p>
              </div>
            </div>

            {feedbackError && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {feedbackError}
              </p>
            )}

            <DialogFooter>
              <Button
                type="submit"
                disabled={!starRating || !feedbackText.trim() || isSavingFeedback}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {isSavingFeedback ? "Saving..." : "Submit Feedback"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
