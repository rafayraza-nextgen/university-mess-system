// Shared billing-derivation rules.
//
// A meal is outstanding when it was consumed AND its billing month has no Paid
// invoice. That state is DERIVED, never stored: attendance.status is constrained
// to 'consumed' | 'opted-out' | 'absent' (see supabase/schema.sql), so there is
// no 'unpaid' or 'paid' row to filter on. Querying attendance for an unpaid row
// returns nothing by construction.
//
// The student dashboard and the admin directory both report balances, so the
// rule lives here once. Written twice, the two surfaces drift and the counter
// disagrees with the student - which is the bug this module exists to prevent.

// Shared so the directory's balance and the settlement notice that follows it
// cannot disagree about formatting. Amounts are always real numbers here - the
// null-safe variant lives in the student dashboard, which renders unpriced
// meals as "—" rather than $0.00.
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0);

// `invoices.billing_month` is free text, so a menu date is matched against every
// plausible spelling an admin might have used. An unmatched month is treated as
// unpaid, which overstates dues rather than understating them.
export const getBillingMonthKeys = (dateKey) => {
  const [year, month] = String(dateKey ?? "").split("-");
  const monthIndex = Number(month) - 1;

  if (!year || !month || Number.isNaN(monthIndex)) {
    return [];
  }

  const monthName = new Date(Date.UTC(Number(year), monthIndex, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });

  return [`${year}-${month}`, `${monthName} ${year}`, `${year}-${month}-01`];
};

// The spelling this app writes whenever it creates an invoice. It is the first
// key getBillingMonthKeys produces, so a row written here matches itself on the
// next fetch.
export const getCanonicalBillingMonth = (dateKey) => getBillingMonthKeys(dateKey)[0] ?? null;

// billing_month is free text, so a month is matched against every spelling an
// admin might have used. Used to tie an invoice back to the meals it covers, and
// never to decide payment state - under the consumption-minus-payments rule, what
// has been paid comes from the invoice total, not from its month label.

// A one-to-many embed arrives as an array; older rows can come back as an object.
export const readEmbeddedMenu = (row) => {
  const embedded = Array.isArray(row?.menus) ? row.menus[0] : row?.menus;
  return embedded ?? null;
};

// attendance.status is constrained to consumed / opted-out / absent, all
// lowercase, but the column is free text in practice and a stray 'Consumed' or
// trailing space would silently drop a meal out of the filter. Normalising in JS
// rather than in SQL matters: a query-time `.eq('status','consumed')` would
// exclude such rows before this code ever sees them.
export const normalizeAttendanceStatus = (status) =>
  String(status ?? "")
    .trim()
    .toLowerCase();

// The join is attendance.student_id -> users.id, both uuid. It is NOT
// users.student_id, which is the human admission number as free text and is
// neither unique nor the same domain - comparing the two never matches.
export const getAttendanceStudentId = (record) => record?.student_id ?? record?.user_id ?? null;

// One row of the itemised ledger.
//
// The badge reports the ATTENDANCE status, not a payment status. Payment is
// recorded per invoice, never per meal, so the schema cannot say whether any
// individual meal has been paid for. Labelling a row "Paid" would assert something
// the data does not support, so consumed rows read "Consumed" and the settled
// position is reported once, as a total.
//
// `counts` marks the rows that make up total consumption.
export const buildLedgerEntry = (record) => {
  const menu = readEmbeddedMenu(record);

  if (!menu) {
    return null;
  }

  const price = menu.price === null || menu.price === undefined ? null : Number(menu.price);
  const status = normalizeAttendanceStatus(record.status);

  const base = {
    id: record.id,
    studentId: getAttendanceStudentId(record),
    date: menu.date,
    mealType: menu.meal_type,
    mainDish: menu.main_dish,
    price,
  };

  if (status === "consumed") {
    return { ...base, status: "Consumed", variant: "amber", counts: true };
  }

  if (status === "opted-out") {
    return { ...base, status: "Opted out", variant: "slate", counts: false };
  }

  if (status === "absent") {
    return { ...base, status: "Absent", variant: "slate", counts: false };
  }

  // Anything unrecognised is treated as not-chargeable rather than billed, so a
  // stray value can never inflate a balance.
  return { ...base, status: status || "Unknown", variant: "slate", counts: false };
};

// Newest meal first.
export const buildLedger = (attendance = []) =>
  attendance
    .map((record) => buildLedgerEntry(record))
    .filter(Boolean)
    .sort((first, second) => second.date.localeCompare(first.date));

// Everything eaten, priced. This is the accrual side of the balance.
export const totalConsumed = (entries = []) =>
  entries.reduce((sum, entry) => (entry.counts ? sum + (entry.price ?? 0) : sum), 0);

// Everything paid, from invoices. Scoped per student so one account's payment
// can never offset another's consumption.
//
// REQUIRES `student_id` in the invoice projection. A query that scopes with
// .eq('student_id', id) but omits the column from .select() yields rows with no
// student_id, every comparison fails, and the result is a silent $0.00 - while
// the same rows still render correctly in a table reading other fields. That is
// why the mismatch is warned about rather than returned quietly.
export const totalPaidFor = (invoices = [], studentId) => {
  if (!studentId) {
    return 0;
  }

  const isPaid = (invoice) =>
    getAttendanceStudentId(invoice) === studentId &&
    String(invoice.payment_status ?? "").trim().toLowerCase() === "paid";

  const total = invoices
    .filter(isPaid)
    .reduce((sum, invoice) => sum + (Number(invoice.total_amount) || 0), 0);

  if (
    import.meta.env?.DEV &&
    total === 0 &&
    invoices.length > 0 &&
    getAttendanceStudentId(invoices[0]) === null
  ) {
    console.warn(
      "totalPaidFor() matched nothing: these invoices carry no student_id. " +
        "Add student_id to the .select() projection, or the balance will read $0.00.",
    );
  }

  return total;
};

// The balance: everything eaten, less everything paid.
//
// Note this can go negative when an invoice does not equal the sum of its meals
// (a flat mess fee, a discount, a late charge). A credit is a real state, so it
// is reported rather than clamped to zero - clamping would hide overpayment.
export const getAmountDue = (entries, invoices, studentId) =>
  totalConsumed(entries.filter((entry) => entry.studentId === studentId)) -
  totalPaidFor(invoices, studentId);

// Per-student balances for the admin directory, on the same rule the student
// dashboard uses: consumption minus payments. Shaped as
// { [studentId]: { total, consumed, paid, meals, unpriced, months } }.
export const summarizeDuesByStudent = (attendance = [], invoices = []) => {
  const summary = {};

  attendance.forEach((record) => {
    const entry = buildLedgerEntry(record);

    if (!entry?.counts) {
      return;
    }

    if (!summary[entry.studentId]) {
      summary[entry.studentId] = {
        total: 0,
        consumed: 0,
        paid: 0,
        meals: 0,
        unpriced: 0,
        months: [],
      };
    }

    const month = getCanonicalBillingMonth(entry.date);

    summary[entry.studentId].consumed += entry.price ?? 0;
    summary[entry.studentId].total += entry.price ?? 0;
    summary[entry.studentId].meals += 1;

    // A meal with no price still counts as eaten. Tracking it separately lets the
    // directory say "3 unpriced meals" instead of showing a clean $0.00 that
    // reads as settled when nothing was priced.
    if (entry.price === null || Number.isNaN(entry.price)) {
      summary[entry.studentId].unpriced += 1;
    }

    if (month && !summary[entry.studentId].months.includes(month)) {
      summary[entry.studentId].months.push(month);
    }
  });

  // Payments are applied after consumption is accumulated, so a student who has
  // paid without eating anything still shows a credit rather than disappearing.
  Object.keys(summary).forEach((studentId) => {
    const paid = totalPaidFor(invoices, studentId);

    summary[studentId].paid = paid;
    summary[studentId].total = summary[studentId].consumed - paid;
  });

  return summary;
};

// Works out what settling a student requires under the consumption-minus-payments
// rule: one entry per billing month in which they ate, carrying that month's
// consumption total and the invoice already raised for it.
//
// Because the balance is `consumption - payments`, simply flipping an invoice to
// Paid is not enough. An invoice whose total_amount disagrees with what was
// actually eaten (a flat mess fee, a discount) leaves a permanent residue, so the
// caller must also set total_amount to the month's consumption. That makes
// payments equal consumption exactly, and the balance lands on 0.00 rather than
// drifting forever.
export const planSettlement = (attendance = [], invoices = [], studentId) => {
  const months = new Map();

  attendance
    .filter((record) => getAttendanceStudentId(record) === studentId)
    .forEach((record) => {
      const entry = buildLedgerEntry(record);

      if (!entry?.counts) {
        return;
      }

      const keys = getBillingMonthKeys(entry.date);
      const canonical = keys[0];

      if (!canonical) {
        return;
      }

      const existing = months.get(canonical) ?? {
        billingMonth: canonical,
        spellings: new Set(keys.map((key) => key.toLowerCase())),
        amount: 0,
        invoiceIds: [],
      };

      existing.amount += entry.price ?? 0;
      months.set(canonical, existing);
    });

  const studentInvoices = invoices.filter(
    (invoice) => getAttendanceStudentId(invoice) === studentId,
  );

  return [...months.values()].map((month) => ({
    billingMonth: month.billingMonth,
    amount: month.amount,
    // Any invoice for this month matches, not only unpaid ones: a Paid invoice
    // still needs its total corrected. An invoice matches if its stored spelling
    // is one this month can be written as, so "August 2026" is linked to the
    // "2026-08" meals rather than duplicated.
    invoiceIds: studentInvoices
      .filter((invoice) => month.spellings.has(String(invoice.billing_month ?? "").toLowerCase()))
      .map((invoice) => invoice.id),
  }));
};
