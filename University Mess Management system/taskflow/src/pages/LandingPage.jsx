import { useEffect, useState } from "react";
import { ArrowRight, CalendarX2, QrCode, ReceiptText } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { consumeFlashNotice } from "@/lib/flash";

const PENDING_STAFF_NOTICE = "Your staff account is pending admin approval.";

const features = [
  {
    title: "QR Code Dining",
    description: "Verify each student instantly with a secure, role-specific meal QR code.",
    icon: QrCode,
    color: "bg-blue-50 text-blue-600",
  },
  {
    title: "Flexible Opt-Outs",
    description: "Skip upcoming meals before the cutoff and keep billing completely up to date.",
    icon: CalendarX2,
    color: "bg-amber-50 text-amber-600",
  },
  {
    title: "Transparent Billing",
    description: "Review meal charges, invoices, and outstanding balances without hidden costs.",
    icon: ReceiptText,
    color: "bg-emerald-50 text-emerald-600",
  },
];

export default function LandingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Read and clear in one step during initialisation, so no setState is needed
  // inside an effect and the message cannot come back on a later visit.
  const [flashNotice] = useState(consumeFlashNotice);

  const isPendingStaff = Boolean(user) && user.accountStatus === "pending";

  // The marketing page is for signed-out visitors only. An authenticated user
  // hitting "/" is sent straight to the dashboard that matches their role. A
  // pending staff applicant stays put: redirecting them to /staff would bounce
  // them straight back here.
  useEffect(() => {
    if (!user || isPendingStaff) {
      return;
    }

    navigate(
      user.role === "admin"
        ? "/admin"
        : user.role === "staff"
          ? "/staff"
          : "/student",
      { replace: true },
    );
  }, [user, isPendingStaff, navigate]);

  const notice = flashNotice || (isPendingStaff ? PENDING_STAFF_NOTICE : "");

  if (user && !isPendingStaff) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center">
          <span className="mx-auto block size-7 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
          <p className="mt-4 text-sm font-medium text-slate-500">
            Taking you to your dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white">
      {notice && (
        <div className="border-b border-amber-200 bg-amber-50">
          <div
            role="status"
            className="mx-auto max-w-7xl px-4 py-3 text-sm font-medium text-amber-900 sm:px-6 lg:px-8"
          >
            {notice}
          </div>
        </div>
      )}

      <section id="about" className="mx-auto max-w-xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
            Smarter campus dining
          </span>
          <h1 className="mt-10 text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            One platform for every university meal.
          </h1>
          <p className="mx-auto mt-10 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Streamline university meals, track attendance, manage opt-outs, and keep every student bill clear—all from one place.
          </p>

          <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button
              nativeButton={false}
              render={<Link to="/student" />}
              size="lg"
              className="w-full bg-blue-600 font-semibold text-white no-underline transition-colors hover:bg-blue-700 sm:w-auto"
            >
              Student Portal
              <ArrowRight className="size-4" />
            </Button>
            <Button
              nativeButton={false}
              render={<Link to="/login" />}
              size="lg"
              variant="outline"
              className="w-full font-semibold text-slate-700 no-underline transition-colors sm:w-auto"
            >
              Admin Login
            </Button>
          </div>
        </div>
      </section>

      <section id="features" className="mt-20 scroll-mt-20 border-t border-slate-200 bg-slate-50/70 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="-mt-9 text-3xl font-bold tracking-tight text-slate-950">
              Built for the whole mess operation
            </h2>
            <p className="mt-8 text-slate-600">
              A simple experience for students, administrators, and cafeteria staff.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;

              return (
                <Card key={feature.title} className="border-slate-200 shadow-sm">
                  <CardHeader>
                    <div className={`grid size-11 place-items-center rounded-xl ${feature.color}`}>
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <CardTitle className="pt-3 text-lg">{feature.title}</CardTitle>
                    <CardDescription className="leading-6">
                      {feature.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent />
                </Card>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
