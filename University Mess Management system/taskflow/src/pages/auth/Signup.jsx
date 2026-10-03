import { useEffect, useState } from "react";
import { Eye, EyeOff, UserPlus } from "lucide-react";
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
import { setFlashNotice } from "@/lib/flash";
import { cn } from "@/lib/utils";

const ACCOUNT_TYPES = [
  { value: "student", label: "Student" },
  { value: "staff", label: "Staff" },
];

// Password strength: at least 8 chars, 1 uppercase, 1 lowercase, 1 number
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&]{8,}$/;

// NOTE: this is a client-side UX gate only. It ships inside the JS bundle, so
// anyone can read it in devtools. It must never be treated as authorization —
// the database refuses self-assigned roles (see users_insert_own_student_profile
// in supabase/policies.sql). A real secret belongs in a Supabase Edge Function.
const STAFF_AUTHORIZATION_CODE = "STAFF-2026";

export default function Signup() {
  const navigate = useNavigate();
  const { user, signup, endSession } = useAuth();
  const [accountType, setAccountType] = useState("student");
  const [staffCode, setStaffCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showStaffCode, setShowStaffCode] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const isStaff = accountType === "staff";

  // AuthContext sets `user` as soon as the profile is created, so this effect
  // performs the redirect and handleSubmit stays free of navigation logic.
  // Staff applicants are handled inside handleSubmit, which ends the session.
  useEffect(() => {
    if (!user || isStaff) {
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
  }, [user, isStaff, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsLoading(true);

    const formData = new FormData(event.currentTarget);
    const identifier = String(formData.get("studentId") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    // Validate password match
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    // Validate password strength
    if (!STRONG_PASSWORD_REGEX.test(password)) {
      setError("Password must be at least 8 characters long and include an uppercase letter, a lowercase letter, and a number.");
      setIsLoading(false);
      return;
    }

    // Validate names
    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter both first and last name");
      setIsLoading(false);
      return;
    }

    const fullName = `${firstName.trim()} ${lastName.trim()}`;

    try {
      if (isStaff && staffCode.trim().toUpperCase() !== STAFF_AUTHORIZATION_CODE) {
        throw new Error("Invalid Staff Authorization Code");
      }

      // The identifier is stored in users.student_id for both account types so
      // the schema needs no migration. A staff request is written as role
      // 'staff' + account_status 'pending', which grants no access at all until
      // an admin approves it.
      const result = await signup(email, password, fullName, identifier, accountType);

      if (result?.requiresEmailConfirmation) {
        setNotice(
          "Account created. Confirm your email address, then sign in to continue.",
        );
        setIsLoading(false);
        return;
      }

      if (isStaff) {
        // signUp() hands back a live session. Drop it so the applicant is not
        // carried into the app as a half-provisioned account, then confirm the
        // request on the public page.
        await endSession();
        setFlashNotice("Staff request submitted! An administrator will review your account.");
        navigate("/", { replace: true });
      }
    } catch (signupError) {
      setError(signupError.message || "Unable to create your account.");
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md border-slate-200 shadow-lg shadow-slate-200/60">
        <form onSubmit={handleSubmit} className="flex flex-col">
          <CardHeader className="text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-600 text-white shadow-sm">
              <UserPlus className="size-6" aria-hidden="true" />
            </div>
            <CardTitle className="pt-2 text-2xl text-slate-950">
              Create {isStaff ? "Staff" : "Student"} Account
            </CardTitle>
            <CardDescription>
              Register for access to university mess services.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {notice && (
              <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm text-blue-800">
                {notice}
              </div>
            )}

            <div className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Account Type</span>
              <div
                role="group"
                aria-label="Account type"
                className="mt-1 flex rounded-lg bg-slate-100 p-1"
              >
                {ACCOUNT_TYPES.map((type) => {
                  const isSelected = accountType === type.value;

                  return (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => {
                        setAccountType(type.value);
                        setError("");
                      }}
                      aria-pressed={isSelected}
                      className={cn(
                        "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
                        isSelected
                          ? "bg-white text-blue-600 shadow-sm"
                          : "bg-transparent text-slate-500 hover:text-slate-700",
                      )}
                    >
                      {type.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Full Name</label>
              <div className="flex gap-4">
                <div className="flex-1 space-y-2">
                  <label htmlFor="first-name" className="text-sm font-medium text-slate-700">
                    First Name
                  </label>
                  <Input
                    id="first-name"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    required
                    disabled={isLoading}
                    placeholder="First name"
                    className="h-11"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <label htmlFor="last-name" className="text-sm font-medium text-slate-700">
                    Last Name
                  </label>
                  <Input
                    id="last-name"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    required
                    disabled={isLoading}
                    placeholder="Last name"
                    className="h-11"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="student-id" className="text-sm font-medium text-slate-700">
                {isStaff ? "Staff ID" : "Student ID"}
              </label>
              <Input
                id="student-id"
                name="studentId"
                type="text"
                autoComplete="off"
                required
                disabled={isLoading}
                placeholder={isStaff ? "Enter your staff ID" : "Enter your student ID"}
                className="h-11 uppercase"
              />
            </div>

            {isStaff && (
              <div className="space-y-2">
                <label htmlFor="staff-code" className="text-sm font-medium text-slate-700">
                  Staff Authorization Code
                </label>
                <div className="relative">
                  <Input
                    id="staff-code"
                    name="staffCode"
                    type={showStaffCode ? "text" : "password"}
                    autoComplete="off"
                    required
                    disabled={isLoading}
                    placeholder="Enter the authorization code"
                    className="h-11 pr-10"
                    value={staffCode}
                    onChange={(event) => setStaffCode(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowStaffCode((current) => !current)}
                    disabled={isLoading}
                    aria-label={
                      showStaffCode ? "Hide authorization code" : "Show authorization code"
                    }
                    aria-pressed={showStaffCode}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:text-slate-700 disabled:opacity-50"
                  >
                    {showStaffCode ? (
                      <EyeOff className="size-5" aria-hidden="true" />
                    ) : (
                      <Eye className="size-5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="signup-email" className="text-sm font-medium text-slate-700">
                University Email
              </label>
              <Input
                id="signup-email"
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
              <label htmlFor="signup-password" className="text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative">
                <Input
                  id="signup-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  disabled={isLoading}
                  placeholder="Create a secure password"
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
            </div>

            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium text-slate-700">
                Confirm Password
              </label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  disabled={isLoading}
                  placeholder="Confirm your password"
                  className="h-11 pr-10"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  disabled={isLoading}
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  aria-pressed={showConfirmPassword}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:text-slate-700 disabled:opacity-50"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="size-5" aria-hidden="true" />
                  ) : (
                    <Eye className="size-5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex-col gap-4">
            <Button
              type="submit"
              disabled={isLoading}
              className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700 mt-4"
            >
              {isLoading
                ? "Creating account..."
                : isStaff
                  ? "Request Staff Account"
                  : "Create Account"}
            </Button>
            <p className="text-center text-sm text-slate-500">
              Already have an account?{" "}
              <Link
                to="/login"
                className="font-semibold text-blue-600 no-underline transition-colors hover:text-blue-700"
              >
                Log in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
