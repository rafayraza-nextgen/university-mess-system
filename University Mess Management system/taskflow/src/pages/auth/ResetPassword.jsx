import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertCircle, CheckCircle2, Eye, EyeOff, Key, Link as LinkIcon, Mail } from "lucide-react";
import { Link } from "react-router-dom";
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

// Password strength: at least 8 chars, 1 uppercase, 1 lowercase, 1 number
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&]{8,}$/;

export default function ResetPassword() {
  const navigate = useNavigate();

  const [step, setStep] = useState("loading"); // "loading" | "reset" | "success" | "error" | "expired"
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [linkError, setLinkError] = useState("");

  // Validate password on change (inline validation)
  const passwordValidation = (() => {
    if (newPassword.length < 8) {
      return { valid: false, message: "Password must be at least 8 characters" };
    }
    if (!STRONG_PASSWORD_REGEX.test(newPassword)) {
      return { valid: false, message: "Password must include an uppercase letter, a lowercase letter, and a number." };
    }
    return { valid: true };
  })();
  const passwordsMatch = newPassword === confirmPassword && newPassword.length > 0;

  // Parse URL hash for Supabase auth errors (e.g., otp_expired, access_denied)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.replace("#", ""));
      const errorCode = params.get("error_code") || params.get("error");
      const errorDescription = params.get("error_description");

      if (errorCode === "otp_expired" || errorCode === "access_denied") {
        const msg = errorDescription || "This password reset link is invalid or has expired.";
        setLinkError(msg);
        setStep("expired");
        return;
      }
    }
  }, []);

  // On mount, check for recovery session in URL hash
  useEffect(() => {
    // If we already detected a link error, don't proceed
    if (step === "expired") return;

    const initializeReset = async () => {
      // Supabase puts the recovery tokens in the URL hash fragment
      // The supabase client automatically detects and handles this via detectSessionInUrl: true
      // But we need to verify we have a valid recovery session

      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error("Session error:", error);
        setError("Invalid or expired reset link. Please request a new one.");
        setStep("error");
        return;
      }

      if (!session) {
        // No session - might be a direct navigation without the magic link
        setError("Invalid or expired reset link. Please request a new one from the forgot password page.");
        setStep("error");
        return;
      }

      // Check if this is a recovery session (type === 'recovery')
      // The session exists, so we can proceed to password reset
      setStep("reset");
    };

    initializeReset();
  }, []);

  const handleResetSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!passwordValidation.valid) {
      setError(passwordValidation.message || "Invalid password.");
      return;
    }

    if (!passwordsMatch) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      // Update the user's password using the active recovery session
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        throw updateError;
      }

      setSuccessMessage("Your password has been updated successfully.");
      setStep("success");
    } catch (resetError) {
      console.error("Password update error:", resetError);
      setError(resetError.message || "Unable to reset password. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestNewLink = () => {
    navigate("/forgot-password");
  };

  // Render loading state
  if (step === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <Card className="w-full max-w-md border-slate-200 shadow-lg shadow-slate-200/60">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="size-8 animate-spin text-blue-600" aria-hidden="true" />
            <p className="mt-4 text-sm font-medium text-slate-500">Verifying reset link...</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Render expired link state (from URL hash error)
  if (step === "expired") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <Card className="w-full max-w-md border-slate-200 shadow-lg shadow-slate-200/60">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Mail className="size-12 text-amber-500" aria-hidden="true" />
            <CardTitle className="mt-4 text-xl text-slate-950">Link Expired</CardTitle>
            <CardDescription className="mt-2">{linkError}</CardDescription>
            <Button
              variant="outline"
              onClick={handleRequestNewLink}
              className="mt-6 w-full"
            >
              Request New Link
            </Button>
            <p className="mt-4 text-center text-sm text-slate-500">
              <Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700">
                Back to Sign In
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Render error state
  if (step === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <Card className="w-full max-w-md border-slate-200 shadow-lg shadow-slate-200/60">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <LinkIcon className="size-12 text-red-500" aria-hidden="true" />
            <CardTitle className="mt-4 text-xl text-slate-950">Invalid Reset Link</CardTitle>
            <CardDescription className="mt-2">{error}</CardDescription>
            <Button
              variant="outline"
              onClick={handleRequestNewLink}
              className="mt-6 w-full"
            >
              Request New Link
            </Button>
            <p className="mt-4 text-center text-sm text-slate-500">
              <Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700">
                Back to Sign In
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md border-slate-200 shadow-lg shadow-slate-200/60">
        <form onSubmit={handleResetSubmit} className="flex flex-col">
          <CardHeader className="text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-600 text-white shadow-sm">
              {step === "success" ? (
                <CheckCircle2 className="size-6" aria-hidden="true" />
              ) : (
                <Key className="size-6" aria-hidden="true" />
              )}
            </div>
            <CardTitle className="pt-2 text-2xl text-slate-950">
              {step === "success" ? "Password Reset" : "Create New Password"}
            </CardTitle>
            <CardDescription>
              {step === "success"
                ? "Your password has been updated successfully."
                : "Enter your new password below. It must be at least 8 characters."}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {error && (
              <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            {successMessage && step === "success" && (
              <div role="status" className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 text-sm text-green-700">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                {successMessage}
              </div>
            )}

            {step === "reset" && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="new-password" className="text-sm font-medium text-slate-700">
                    New Password
                  </label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      disabled={isLoading}
                      placeholder="Enter new password"
                      className="h-11 pr-10"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      disabled={isLoading}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:text-slate-700 disabled:opacity-50"
                    >
                      {showPassword ? (
                        <EyeOff className="size-5" aria-hidden="true" />
                      ) : (
                        <Eye className="size-5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {newPassword && !passwordValidation.valid && (
                    <p className="text-xs text-red-600">{passwordValidation.message}</p>
                  )}
                  {newPassword && passwordValidation.valid && (
                    <p className="text-xs text-green-600">Password meets requirements</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="confirm-password" className="text-sm font-medium text-slate-700">
                    Confirm New Password
                  </label>
                  <Input
                    id="confirm-password"
                    name="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    disabled={isLoading}
                    placeholder="Confirm new password"
                    className="h-11"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  {confirmPassword && !passwordsMatch && (
                    <p className="text-xs text-red-600">Passwords do not match</p>
                  )}
                  {confirmPassword && passwordsMatch && (
                    <p className="text-xs text-green-600">Passwords match</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex-col gap-4">
            {step === "reset" && (
              <Button
                type="submit"
                disabled={isLoading || !passwordValidation.valid || !passwordsMatch}
                className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" aria-hidden="true" />
                    Resetting...
                  </>
                ) : (
                  "Reset Password"
                )}
              </Button>
            )}

            {step === "success" && (
              <Button
                asChild
                className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
              >
                <Link to="/login">Continue to Sign In</Link>
              </Button>
            )}

            <p className="text-center text-sm text-slate-500">
              {step === "success" ? (
                <>
                  Your password has been reset.{" "}
                  <Link
                    to="/login"
                    className="font-semibold text-blue-600 no-underline transition-colors hover:text-blue-700"
                  >
                    Sign in now
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    to="/forgot-password"
                    className="font-semibold text-blue-600 no-underline transition-colors hover:text-blue-700"
                  >
                    Need a new link?
                  </Link>
                  {" | "}
                  <Link
                    to="/login"
                    className="font-semibold text-blue-600 no-underline transition-colors hover:text-blue-700"
                  >
                    Back to Sign In
                  </Link>
                </>
              )}
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}