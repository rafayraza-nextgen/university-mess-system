import { useEffect, useState } from "react";
import { Eye, EyeOff, Utensils } from "lucide-react";
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
import { useAuth } from "@/context/AuthContext";

export default function Login() {
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // AuthContext updates `user` once the profile is resolved, so navigation is
  // driven by state instead of by the login request itself.
  useEffect(() => {
    if (!user) {
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
  }, [user, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    try {
      await login(email, password);
    } catch (loginError) {
      setError(loginError.message || "Unable to sign in. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md border-slate-200 shadow-lg shadow-slate-200/60">
        <form onSubmit={handleSubmit} className="flex flex-col">
          <CardHeader className="text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-600 text-white shadow-sm">
              <Utensils className="size-6" aria-hidden="true" />
            </div>
            <CardTitle className="pt-2 text-2xl text-slate-950">University Mess</CardTitle>
            <CardDescription>Log in to continue to your dashboard.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="university-email" className="text-sm font-medium text-slate-700">
                University Email
              </label>
              <Input
                id="university-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={isLoading}
                placeholder="Enter your university email"
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  placeholder="Enter your password"
                  className="h-11 pr-10"
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
              <div className="flex justify-end pt-0.5">
                <Link
                  to="/forgot-password"
                  className="text-sm font-medium text-blue-600 no-underline transition-colors hover:text-blue-800"
                >
                  Forgot your password?
                </Link>
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex-col gap-4">
            <Button
              type="submit"
              disabled={isLoading}
              className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700 mt-4"
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
            <p className="text-center text-sm text-slate-500">
              New student?{" "}
              <Link
                to="/signup"
                className="font-semibold text-blue-600 no-underline transition-colors hover:text-blue-700"
              >
                Create an account
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
