import { useState } from "react";
import { Loader2, Mail, AlertCircle, CheckCircle2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState("request"); // "request" | "sent"
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const formData = new FormData(event.currentTarget);
    const submittedEmail = String(formData.get("email") || "").trim().toLowerCase();

    if (!submittedEmail || !submittedEmail.includes("@")) {
      setError("Please enter a valid university email address.");
      setIsLoading(false);
      return;
    }

    try {
      // Use Supabase's built-in password reset email
      // The redirectTo URL must be added to Supabase Auth > URL Configuration > Redirect URLs
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(submittedEmail, {
        redirectTo: "http://localhost:5173/reset-password",
      });

      if (resetError) {
        throw resetError;
      }

      setStep("sent");
      setEmail(submittedEmail);
    } catch (resetError) {
      console.error("Password reset error:", resetError);
      setError(resetError.message || "Unable to send reset link. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setError("");
    setIsLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: "http://localhost:5173/reset-password",
      });

      if (resetError) {
        throw resetError;
      }
    } catch (resetError) {
      console.error("Password resend error:", resetError);
      setError(resetError.message || "Unable to resend reset link. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md border-slate-200 shadow-lg shadow-slate-200/60">
        <form onSubmit={handleSubmit} className="flex flex-col">
          <CardHeader className="text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-600 text-white shadow-sm">
              {step === "sent" ? (
                <CheckCircle2 className="size-6" aria-hidden="true" />
              ) : (
                <Mail className="size-6" aria-hidden="true" />
              )}
            </div>
            <CardTitle className="pt-2 text-2xl text-slate-950">
              {step === "sent" ? "Check your email" : "Forgot Password"}
            </CardTitle>
            <CardDescription>
              {step === "sent" ? (
                <>
                  We've sent a password reset link to <strong>{email}</strong>. The link expires in 1 hour.
                </>
              ) : (
                "Enter your university email to receive a password reset link."
              )}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {error && (
              <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            {step === "sent" && !error && (
              <div role="status" className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 text-sm text-green-700">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  If an account with that email exists, a password reset link has been sent.
                </span>
              </div>
            )}

            {step === "request" && (
              <div className="space-y-2">
                <label htmlFor="reset-email" className="text-sm font-medium text-slate-700">
                  University Email
                </label>
                <Input
                  id="reset-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isLoading}
                  placeholder="Enter your university email"
                  className="h-11"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}

            {step === "sent" && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Didn't receive the email? Check your spam folder, or request a new link.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResend}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" aria-hidden="true" />
                      Sending...
                    </>
                  ) : (
                    "Resend Link"
                  )}
                </Button>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex-col gap-4">
            {step === "request" && (
              <Button
                type="submit"
                disabled={isLoading}
                className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" aria-hidden="true" />
                    Sending...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>
            )}

            <p className="text-center text-sm text-slate-500">
              Remember your password?{" "}
              <Link
                to="/login"
                className="font-semibold text-blue-600 no-underline transition-colors hover:text-blue-700"
              >
                Back to Sign In
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}