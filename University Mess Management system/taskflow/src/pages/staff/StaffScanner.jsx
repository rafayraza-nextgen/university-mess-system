// Install the camera scanner with:
//   npm install @yudiel/react-qr-scanner
// (react-qr-reader is deprecated; @yudiel/react-qr-scanner is the maintained fork)

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  CameraOff,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Square,
  UserRoundCheck,
  UtensilsCrossed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateKey, getLocalDateKey, getLocalTimeString, shiftDateKey } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// The barcode detector ships a large wasm bundle, so it is only fetched when the
// camera is actually opened rather than on every dashboard load.
const Scanner = lazy(() =>
  import("@yudiel/react-qr-scanner").then((module) => ({ default: module.Scanner })),
);

// A student is blocked from further meals once their outstanding balance
// reaches this figure.
const OUTSTANDING_LIMIT = 50;

// Window during which a generated pass is accepted. Stops a screenshot or a
// printed code being reused for free meals.
const QR_MAX_AGE_MS = 5 * 60 * 1000;

// Ignore repeat detections of the same code for this long, so one pass cannot
// be charged twice.
const SCAN_COOLDOWN_MS = 3000;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0);

// The authoritative unpaid balance lives on invoices.payment_status, which is
// the same figure the admin "Clear Dues" button settles. Summing consumed
// attendance instead would count meals that have already been paid for and
// would only ever grow, because attendance.status cannot be marked paid, so a
// student who settles would be suspended again on their very next visit.
const fetchOutstandingBalance = async (studentId) => {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, billing_month, total_amount")
    .eq("student_id", studentId)
    .eq("payment_status", "Pending");

  if (error) {
    return { total: null, months: [], error };
  }

  const rows = data ?? [];

  return {
    total: rows.reduce((sum, invoice) => sum + (Number(invoice.total_amount) || 0), 0),
    months: rows.map((invoice) => invoice.billing_month),
    error: null,
  };
};

// Finds the meal whose service window contains the current local time.
// Rows with a null start_time or end_time compare as NULL and are therefore
// excluded, which fails closed for any meal that has not been scheduled yet.
// .single() is avoided because "no active meal" is the common case and would
// return a 406 instead of an empty result.
const findActiveMenu = async (dateKey, timeString) => {
  const { data, error } = await supabase
    .from("menus")
    .select("id, meal_type, main_dish, start_time, end_time")
    .eq("date", dateKey)
    .eq("status", "Published")
    .lte("start_time", timeString)
    .gte("end_time", timeString)
    // Deterministic when two windows overlap. Without an ORDER BY, .limit(1)
    // returns whichever row Postgres happens to produce first, so a mess running
    // an early window alongside a later one could bill the same student as
    // either meal across two otherwise identical scans. Ordering by the most
    // recently started window makes the later meal win, which matches the
    // transition the student is actually making.
    .order("start_time", { ascending: false })
    .limit(1);

  return { menu: data?.[0] ?? null, error };
};

// PostgREST returns an embedded resource as an object for a to-one relation,
// but normalise anyway so a future to-many change cannot break rendering.
const readEmbedded = (row, relation) => {
  const value = row?.[relation];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
};

// attendance has no timestamp column, so recency is derived from the meal date
// the scan belongs to and ordered by the embedded resource.
const fetchRecentScans = async (limit = 10) => {
  const { data, error } = await supabase
    .from("attendance")
    .select(
      "id, status, student_id, menu_id, users ( full_name, student_id ), menus ( id, date, meal_type, main_dish )",
    )
    .eq("status", "consumed")
    .order("menus(date)", { ascending: false })
    .limit(limit);

  return { data: data ?? [], error };
};

// A typed student ID is matched against users.student_id, which is nullable and
// not unique, so .single() would throw on both zero and multiple matches. The
// scanned pass carries the auth UUID instead, which is the primary key.
const resolveUser = async ({ studentId, authId }) => {
  let query = supabase
    .from("users")
    .select("id, full_name, role, account_status");

  query = authId ? query.eq("id", authId) : query.eq("student_id", studentId);

  const { data, error } = await query.limit(1);

  return { user: data?.[0] ?? null, error };
};

// The pass is plain JSON written by the student dashboard. It carries no
// signature, so this validates shape and freshness only; see the note in the
// component about server-side signing.
const parseQrPayload = (raw) => {
  let payload;

  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: "That QR code is not a University Mess pass." };
  }

  if (!payload || typeof payload.student_id !== "string") {
    return { error: "That QR code is not a University Mess pass." };
  }

  const issuedAt = Date.parse(payload.timestamp);

  if (Number.isNaN(issuedAt)) {
    return { error: "That pass is missing a valid timestamp." };
  }

  if (issuedAt - Date.now() > 60 * 1000) {
    return { error: "That pass has an invalid timestamp." };
  }

  if (Date.now() - issuedAt > QR_MAX_AGE_MS) {
    return { error: "That pass has expired. Ask the student to generate a new one." };
  }

  return { authId: payload.student_id };
};

// attendance stores no scan time, so the day comes from the meal being served.
const getScanDayLabel = (dateKey, todayKey) => {
  if (dateKey === todayKey) return "Today";
  if (dateKey === shiftDateKey(todayKey, -1)) return "Yesterday";
  return formatDateKey(dateKey, { month: "short", day: "numeric" });
};

// Human-readable copy per failure kind. The library reports OverconstrainedError
// as 'overconstrained' and NotReadableError ("hardware busy") as 'in-use'.
const CAMERA_ERROR_MESSAGES = {
  "permission-denied":
    "Camera permission was denied. Allow camera access in your browser, then press Start Scanner again.",
  "in-use":
    "The camera is busy in another app. Close any video call or camera app, then press Try again. You can still use the manual override below.",
  "no-camera":
    "No camera was found on this device. Use the manual override below, or connect a camera and retry.",
  "overconstrained":
    "This camera could not satisfy the requested settings. Use the manual override below, or pick a different camera.",
  "insecure-context":
    "Camera access needs a secure origin. Open the app over HTTPS or on localhost.",
  unsupported:
    "This browser cannot scan barcodes. Try Chrome, Edge, Safari or a newer browser.",
  security: "The browser blocked camera access. Check the site camera permission.",
  aborted: "Camera start was interrupted. Press Start Scanner again.",
};

// The library merges these over its own defaults with a shallow spread, so each
// key here REPLACES a default rather than merging into it. Kept at module scope
// so the reference stays stable and the library's constraints memo cannot loop.
const CAMERA_CONSTRAINTS = {
  // The default is facingMode: 'environment'. An explicit undefined wins the
  // spread and is dropped by WebIDL dictionary conversion, which leaves the
  // browser free to use whatever default camera the device has.
  facingMode: undefined,
  // The defaults are width/height with a hard `min: 640`, not `ideal`. A 640x480
  // built-in webcam cannot satisfy that and raises OverconstrainedError, so
  // these objects replace them outright with advisory values.
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

// The library applies these as INLINE styles, which outrank Tailwind classes.
// Its container default also pins `aspectRatio: '1/1'`, so a square viewport is
// layered inside the wrapper unless that is explicitly neutralised here.
const SCANNER_STYLES = {
  container: {
    width: "100%",
    height: "100%",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    aspectRatio: "auto",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center",
    // The library's two canvas overlays are absolutely positioned with no
    // z-index, so the video is pinned to the base layer explicitly instead of
    // relying on paint order, and block-level stops an inline gap.
    display: "block",
    position: "relative",
    zIndex: 0,
  },
};

// A hardware-busy device is usually still releasing the previous track, so the
// remount is spaced out instead of fired immediately.
const MAX_BUSY_RETRIES = 3;
const BUSY_RETRY_BASE_MS = 700;

// The library can fire an error or two while the stream is still opening. These
// are swallowed so start-up does not flash a warning, while a camera that
// genuinely never comes up still surfaces its reason.
const MAX_TRANSIENT_ERRORS = 2;

// The list of video inputs, or null when the browser will not say. Checked
// before mounting so a device with no camera shows a message instead of a
// hanging black viewport.
const detectVideoInputs = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return null;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "videoinput");
  } catch {
    return null;
  }
};

export default function StaffScanner() {
  const [manualStudentId, setManualStudentId] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isVerifying, setIsVerifying] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanCooldown, setScanCooldown] = useState(false);
  const [cameraError, setCameraError] = useState("");
  // Bumped to remount the scanner, which is the only way to make the library
  // call getUserMedia again after its stream was released.
  const [cameraNonce, setCameraNonce] = useState(0);
  const [busyRetries, setBusyRetries] = useState(0);
  // True when a stream is attached but no frame ever decodes, which looks
  // identical to a black box. Surfacing it turns a mystery into a message.
  const [videoStalled, setVideoStalled] = useState(false);
  const [scannerMessage, setScannerMessage] = useState("Awaiting QR Scan...");
  const [recentScans, setRecentScans] = useState([]);
  const [isLoadingScans, setIsLoadingScans] = useState(true);
  const [scansError, setScansError] = useState("");

  const scannerRef = useRef(null);
  // Deduplicates console output and counts start-up noise.
  const transientErrorsRef = useRef(0);
  const lastLoggedRef = useRef("");
  const todayKey = getLocalDateKey();

  // Release the camera when the scanner is closed, the tab is switched away, or
  // the component unmounts. Without this the track stays live, the device
  // camera light stays on, and the next start attempt fails with 'in-use'.
  useEffect(() => {
    if (!isScanning) {
      return undefined;
    }

    const stopStream = () => {
      const stream = scannerRef.current?.getStream?.();

      stream?.getTracks().forEach((track) => track.stop());
      scannerRef.current = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // The stream was released while hidden, so remount to reacquire it
        // rather than leaving a dead black viewport.
        setCameraNonce((current) => current + 1);
        return;
      }

      stopStream();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopStream();
    };
  }, [isScanning]);

  // A connected MediaStream can still fail to deliver frames, which renders as
  // a black viewport. readyState >= 2 means HAVE_CURRENT_DATA, i.e. the decoder
  // has produced at least one frame, so that is the check which separates
  // "camera is off" from "camera is on but showing nothing".
  useEffect(() => {
    if (!isScanning) {
      return undefined;
    }

    const startedAt = Date.now();
    let timerId;

    const checkForFrames = () => {
      const video = scannerRef.current?.getVideoElement?.();

      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        setVideoStalled(false);
        return;
      }

      if (Date.now() - startedAt > 5000) {
        setVideoStalled(true);
        return;
      }

      timerId = window.setTimeout(checkForFrames, 400);
    };

    timerId = window.setTimeout(checkForFrames, 400);

    return () => window.clearTimeout(timerId);
  }, [isScanning, cameraNonce]);

  // Shared result handling for the mount fetch and manual refreshes.
  const applyScanResult = ({ data, error }) => {
    if (error) {
      console.warn("Unable to load recent scans.", error);
      setScansError("We could not load recent scans. Please refresh to try again.");
    } else {
      setScansError("");
      setRecentScans(data);
    }

    setIsLoadingScans(false);
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      const result = await fetchRecentScans();

      if (!active) return;

      applyScanResult(result);
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  // Silent reload keeps the list current without flashing the skeleton.
  const reloadScans = async () => {
    applyScanResult(await fetchRecentScans());
  };

  // Loading starts as true so the skeleton shows on mount; refreshes opt back in.
  const refreshScans = () => {
    setIsLoadingScans(true);
    reloadScans();
  };

  // Single recording pipeline shared by the manual override and the camera, so
  // the account, financial and meal-window rules cannot drift between them.
  //
  // Naming note: this appends a consumed meal to the student's ledger. It does
  // not subtract from a balance or a quota - billing is postpaid, and the
  // outstanding figure is derived later from consumption minus payments.
  const processMealRecord = async ({ studentId, authId }) => {
    if (isVerifying) {
      return;
    }

    setIsVerifying(true);
    setFeedback({ type: "", message: "" });

    try {
      // Step A: resolve the student and check the account is usable.
      const { user, error: userError } = await resolveUser({ studentId, authId });

      if (userError) {
        console.warn("Student lookup failed.", userError);
        setFeedback({ type: "error", message: "Could not look up that student. Please try again." });
        return;
      }

      if (!user) {
        setFeedback({
          type: "error",
          message: studentId
            ? `Student ID "${studentId}" not found.`
            : "That pass does not match any account.",
        });
        return;
      }

      if (user.account_status === "suspended") {
        setFeedback({ type: "error", message: "Access Denied: Student account is suspended." });
        return;
      }

      // Step B: financial limit, checked before the meal lookup so a blocked
      // student is never served.
      const {
        total: outstanding,
        months: unpaidMonths,
        error: balanceError,
      } = await fetchOutstandingBalance(user.id);

      if (balanceError) {
        console.warn("Outstanding balance lookup failed.", balanceError);
        setFeedback({
          type: "error",
          message: "Could not check the outstanding balance. Please see the counter.",
        });
        return;
      }

      if (outstanding >= OUTSTANDING_LIMIT) {
        const months = unpaidMonths.length ? ` (${unpaidMonths.join(", ")})` : "";

        // Flag the account, but only claim success once the row is confirmed
        // written: a write that RLS filters out reports success with no row.
        const { data: suspendedUser, error: suspendError } = await supabase
          .from("users")
          .update({ account_status: "suspended" })
          .eq("id", user.id)
          .select("id, account_status")
          .maybeSingle();

        if (suspendError || !suspendedUser) {
          console.warn("Over the limit but the account could not be flagged.", suspendError);
          setFeedback({
            type: "error",
            message: `Over the ${formatCurrency(OUTSTANDING_LIMIT)} limit (balance ${formatCurrency(outstanding)}${months}). The account could not be flagged automatically. Please see the counter.`,
          });
          return;
        }

        setFeedback({
          type: "error",
          message: `Account Suspended: Unpaid balance of ${formatCurrency(outstanding)}${months} has reached the ${formatCurrency(OUTSTANDING_LIMIT)} limit. An administrator can settle it and restore access.`,
        });
        return;
      }

      // Step C: only a meal whose service window contains the current time can
      // be recorded.
      const { menu, error: menuError } = await findActiveMenu(todayKey, getLocalTimeString());

      if (menuError) {
        console.warn("Menu lookup failed.", menuError);
        setFeedback({ type: "error", message: "Could not load today's menu. Please try again." });
        return;
      }

      if (!menu) {
        setFeedback({
          type: "error",
          message: "Meal Service Closed: No active meals scheduled at this current time.",
        });
        return;
      }

      // Step D: record the consumption. Selecting the row back matters: an upsert
      // that RLS filters out still reports success with no row returned.
      const { data: written, error: upsertError } = await supabase
        .from("attendance")
        .upsert(
          { student_id: user.id, menu_id: menu.id, status: "consumed" },
          { onConflict: "student_id,menu_id" },
        )
        .select("id")
        .maybeSingle();

      if (upsertError) {
        console.warn("Unable to record the meal.", upsertError);
        setFeedback({ type: "error", message: "Could not record the meal. Please try again." });
        return;
      }

      if (!written) {
        setFeedback({ type: "error", message: "The meal could not be recorded. Check your permissions." });
        return;
      }

      setManualStudentId("");
      setFeedback({
        type: "success",
        message: `Meal recorded for ${user.full_name} (${menu.meal_type}: ${menu.main_dish}).`,
      });
      setScannerMessage(`Verified ${user.full_name}`);

      await reloadScans();
    } catch (unexpectedError) {
      console.error("Unexpected failure during manual verification.", unexpectedError);
      setFeedback({ type: "error", message: "Something went wrong. Please try again." });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleManualSubmit = async (event) => {
    event.preventDefault();

    const studentId = manualStudentId.trim();

    if (!studentId) {
      return;
    }

    await processMealRecord({ studentId });
  };

  const handleScannerError = (error) => {
    const signature = `${error?.kind ?? "unknown"}:${error?.message ?? ""}`;

    // "Hardware busy" means the previous stream has not been released yet, which
    // is common right after a remount or when another app holds the device.
    // Remount again after a short backoff instead of failing on the first try.
    if (error?.kind === "in-use" && busyRetries < MAX_BUSY_RETRIES) {
      const attempt = busyRetries + 1;

      if (lastLoggedRef.current !== signature) {
        lastLoggedRef.current = signature;
        console.debug("Camera busy, retrying.", error);
      }

      window.setTimeout(() => {
        setBusyRetries(attempt);
        setCameraNonce((current) => current + 1);
      }, BUSY_RETRY_BASE_MS * attempt);

      return;
    }

    // Opening a camera stream is not instant, and the library can report a
    // failure before it has finished mounting. Swallow the first couple so the
    // console stays clean, but never hide a persistent failure.
    if (transientErrorsRef.current < MAX_TRANSIENT_ERRORS) {
      transientErrorsRef.current += 1;

      if (lastLoggedRef.current !== signature) {
        lastLoggedRef.current = signature;
        console.debug("QR scanner is still starting.", error);
      }

      return;
    }

    if (lastLoggedRef.current !== signature) {
      lastLoggedRef.current = signature;
      console.warn("QR scanner failed to start.", error);
    }

    setCameraError(
      CAMERA_ERROR_MESSAGES[error?.kind] ??
        "Camera error. Check that the app is on HTTPS or localhost, that permission is granted, and that no other app is using the camera. The manual override below still works.",
    );
  };

  const toggleScanner = async () => {
    if (isScanning) {
      setIsScanning(false);
      return;
    }

    setCameraError("");
    setBusyRetries(0);
    setVideoStalled(false);
    transientErrorsRef.current = 0;
    lastLoggedRef.current = "";
    setCameraNonce((current) => current + 1);

    // Check for a camera before mounting, so a device with none shows a message
    // instead of a blank viewport waiting on a getUserMedia that cannot succeed.
    const videoInputs = await detectVideoInputs();

    if (videoInputs && videoInputs.length === 0) {
      setCameraError(CAMERA_ERROR_MESSAGES["no-camera"]);
      return;
    }

    setIsScanning(true);
  };

  // Errors the camera raises while hunting for a code are pure noise, so only
  // the decoded payload is reported.
  const handleScan = async (detectedCodes) => {
    const rawValue = detectedCodes?.[0]?.rawValue;

    if (!rawValue || scanCooldown || isVerifying) {
      return;
    }

    setScanCooldown(true);

    const parsed = parseQrPayload(rawValue);

    if (parsed.error) {
      setFeedback({ type: "error", message: parsed.error });
      setScannerMessage("Not a valid pass");
    } else {
      setScannerMessage("Pass read");
      await processMealRecord({ authId: parsed.authId });
    }

    window.setTimeout(() => setScanCooldown(false), SCAN_COOLDOWN_MS);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Staff Meal Scanner</h1>
        <p className="mt-2 text-slate-600">Scan a student QR code or use the manual student ID override.</p>
      </div>

      <Card className="overflow-hidden border-slate-200 shadow-lg">
        <CardHeader className="border-b border-slate-200">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Camera Scanner</CardTitle>
              <CardDescription>Hold the student&apos;s pass inside the frame.</CardDescription>
            </div>
            <Button
              type="button"
              onClick={toggleScanner}
              disabled={isVerifying}
              className={
                isScanning
                  ? "bg-slate-700 text-white hover:bg-slate-800"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }
            >
              {isScanning ? (
                <>
                  <Square className="size-4" /> Stop Scanner
                </>
              ) : (
                <>
                  <ScanLine className="size-4" /> Start Scanner
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="relative h-64 w-full overflow-hidden bg-black sm:h-80 md:h-96">
            {isScanning ? (
              <>
                <Suspense
                  fallback={
                    <div className="absolute inset-0 grid place-items-center text-white">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Loading scanner...
                      </div>
                    </div>
                  }
                >
                  <Scanner
                    // Remounting is what forces a fresh getUserMedia call, both
                    // for the busy backoff and after a visibility round trip.
                    key={cameraNonce}
                    ref={scannerRef}
                    onScan={handleScan}
                    onError={handleScannerError}
                    // Overrides the library's facingMode and its hard
                    // min: 640 resolution floor, which is what a 640x480 webcam
                    // was rejecting.
                    constraints={CAMERA_CONSTRAINTS}
                    // Inline styles: drops the default square aspect ratio and
                    // makes the video fill the box. These outrank Tailwind
                    // classes, so this is the only reliable place to size it.
                    styles={SCANNER_STYLES}
                    allowMultiple={false}
                    scanDelay={SCAN_COOLDOWN_MS}
                    sound
                  />
                </Suspense>

                {videoStalled && !cameraError && (
                  <div className="absolute inset-0 grid place-items-center px-6 text-center">
                    <div className="max-w-sm">
                      <CameraOff className="mx-auto size-8 text-amber-400" aria-hidden="true" />
                      <p role="alert" className="mt-3 text-sm font-semibold text-white">
                        Camera on, but no video
                      </p>
                      <p className="mt-1.5 text-sm text-slate-300">
                        The stream started but the device is not delivering frames.
                        Close other camera apps, then retry. The manual override below
                        still works.
                      </p>
                    </div>
                  </div>
                )}

                {cameraError && (
                  <div className="absolute inset-0 grid place-items-center px-6 text-center">
                    <div className="max-w-sm">
                      <CameraOff className="mx-auto size-8 text-amber-400" aria-hidden="true" />
                      <p role="alert" className="mt-3 text-sm font-semibold text-white">
                        Camera unavailable
                      </p>
                      <p className="mt-1.5 text-sm text-slate-300">{cameraError}</p>
                      <Button
                        type="button"
                        onClick={toggleScanner}
                        className="mt-4 bg-white text-slate-950 hover:bg-slate-100"
                      >
                        <RefreshCw className="size-4" aria-hidden="true" />
                        Try again
                      </Button>
                    </div>
                  </div>
                )}

                {scanCooldown && (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950/70">
                    <div className="flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-slate-900">
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Processing pass...
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="absolute inset-0 grid place-items-center px-6 text-center text-white">
                <div>
                  <div className="mx-auto grid size-16 place-items-center rounded-2xl border border-slate-700 bg-slate-900">
                    <ScanLine className="size-8 text-blue-400" aria-hidden="true" />
                  </div>
                  <p className="mt-5 text-lg font-semibold">{scannerMessage}</p>
                  <p className="mt-2 text-sm text-slate-400">
                    Start the scanner to use the device camera.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRoundCheck className="size-5 text-blue-600" /> Manual Override
          </CardTitle>
          <CardDescription>Use only when a student's QR code cannot be scanned.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleManualSubmit} className="space-y-3 sm:flex">
            <Input
              value={manualStudentId}
              onChange={(event) => setManualStudentId(event.target.value)}
              placeholder="Enter Student ID"
              aria-label="Student ID"
              disabled={isVerifying}
              className="h-11 flex-1"
            />
            <Button
              type="submit"
              disabled={isVerifying}
              className="h-11 bg-blue-600 text-white hover:bg-blue-700"
            >
              <ShieldCheck className="size-4" />
              {isVerifying ? "Verifying..." : "Verify & Record Meal"}
            </Button>
          </form>

          {feedback.message && (
            <p
              role="status"
              className={cn(
                "mt-3 flex items-start gap-1.5 text-sm font-medium",
                feedback.type === "success" ? "text-emerald-700" : "text-red-700",
              )}
            >
              {feedback.type === "success" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <UtensilsCrossed className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              <span>{feedback.message}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Recent Scans</CardTitle>
            <CardDescription>Latest cafeteria entry activity.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {isLoadingScans ? "..." : `${recentScans.length} scans`}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={refreshScans}
              disabled={isLoadingScans}
              aria-label="Refresh recent scans"
              title="Refresh recent scans"
              className="text-slate-500 hover:text-blue-600"
            >
              <RefreshCw
                className={cn("size-4", isLoadingScans && "animate-spin")}
                aria-hidden="true"
              />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {scansError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
              {scansError}
            </div>
          )}

          {isLoadingScans ? (
            <div className="space-y-4">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-3">
                  <div className="size-10 shrink-0 animate-pulse rounded-full bg-slate-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentScans.length > 0 ? (
            <div className="divide-y divide-slate-200">
              {recentScans.map((scan) => {
                const profile = readEmbedded(scan, "users");
                const menu = readEmbedded(scan, "menus");
                const isSuccess = scan.status === "consumed";

                return (
                  <div key={scan.id} className="flex items-center gap-3 py-4 first:pt-0 last:pb-0">
                    <div className={cn("grid size-10 shrink-0 place-items-center rounded-full", isSuccess ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600")}>
                      {isSuccess ? <CheckCircle2 className="size-5" /> : <UtensilsCrossed className="size-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">
                        {profile?.full_name || "Unknown Student"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {profile?.student_id || "No ID"}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize", isSuccess ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                        {scan.status}
                      </span>
                      <p className="mt-1 flex items-center justify-end gap-1 text-xs text-slate-400">
                        <Clock3 className="size-3" />
                        {menu ? (
                          <span className="truncate">
                            {menu.meal_type} · {getScanDayLabel(menu.date, todayKey)}
                          </span>
                        ) : (
                          "Unknown meal"
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
              <UtensilsCrossed className="mx-auto size-6 text-slate-300" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-slate-500">
                No recent scans recorded.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
