import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";

export const AuthContext = createContext(null);

// How often an already-open tab re-checks the profile in the background. The
// auth session is long lived, so a role or status change made by an admin would
// otherwise go unnoticed until the next sign-in.
const PROFILE_REVALIDATE_MS = 5 * 60 * 1000;

// Statuses that revoke access entirely. A suspended or rejected account is
// signed out rather than left holding a working session.
const REVOKED_STATUSES = ["suspended", "rejected"];

const createFallbackUser = (authUser) => {
  const emailName = authUser.email
    ? authUser.email
        .split("@")[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(" ")
    : "University User";

  return {
    id: authUser.id,
    name: authUser.user_metadata?.full_name || emailName || "University User",
    email: authUser.email,
    role: "student",
    studentId: authUser.user_metadata?.student_id || null,
    accountStatus: "active",
  };
};

const fetchUserProfile = async (authUser) => {
  const fallbackUser = createFallbackUser(authUser);
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, role, student_id, email, account_status")
    .eq("id", authUser.id)
    .maybeSingle();

  if (error) {
    console.warn(
      `Unable to load the profile for user ${authUser.id}; using the auth session fallback.`,
      error,
    );
    return fallbackUser;
  }

  if (!data) {
    console.warn(
      `No public.users row was found for user ${authUser.id}; defaulting the role to student.`,
    );
    return fallbackUser;
  }

  return {
    id: data.id,
    name: data.full_name || fallbackUser.name,
    email: data.email || authUser.email,
    role: data.role || "student",
    studentId: data.student_id || fallbackUser.studentId,
    accountStatus: data.account_status || "active",
  };
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // The auth user and the last known role/status, so background revalidation
  // does not need to re-subscribe every time the session object changes
  // identity, and an unchanged profile does not re-render the tree.
  const authUserRef = useRef(null);
  const lastKnownRef = useRef({ role: null, accountStatus: null });
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let pendingTimer;

    const syncSession = async (nextSession, showLoading = false) => {
      if (!active) return;

      if (showLoading) {
        setLoading(true);
      }

      if (!nextSession?.user) {
        authUserRef.current = null;
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }

      authUserRef.current = nextSession.user;

      try {
        const profile = await fetchUserProfile(nextSession.user);
        if (!active) return;
        lastKnownRef.current = {
          role: profile.role,
          accountStatus: profile.accountStatus,
        };
        setSession(nextSession);
        setUser(profile);
      } catch (profileError) {
        // A missing or inaccessible profile must not break authentication.
        console.warn(
          "Unexpected profile lookup failure; using the auth session fallback.",
          profileError,
        );
        if (!active) return;
        setSession(nextSession);
        setUser(createFallbackUser(nextSession.user));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    const initialize = async () => {
      const { data } = await supabase.auth.getSession();
      await syncSession(data.session, true);
    };

    initialize();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        // Deferring the profile query avoids blocking Supabase's internal
        // token-refresh work inside the auth callback.
        pendingTimer = window.setTimeout(() => {
          // TOKEN_REFRESHED used to only swap the session object, which left a
          // long-lived tab on a stale role or status for up to an hour. Every
          // event now re-reads public.users.
          syncSession(nextSession);
        }, 0);
      },
    );

    return () => {
      active = false;
      if (pendingTimer) window.clearTimeout(pendingTimer);
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Re-reads public.users for the signed-in user. ProtectedRoute already reads
  // user.role on every render, so correcting the context here is enough to move
  // the user between dashboards and revoke access.
  const refreshProfile = useCallback(async () => {
    const authUser = authUserRef.current;

    if (!authUser || !isMountedRef.current) {
      return;
    }

    try {
      const profile = await fetchUserProfile(authUser);

      if (!isMountedRef.current) {
        return;
      }

      // Access was revoked while this tab was open: end the session instead of
      // leaving a suspended or rejected account fully functional.
      if (REVOKED_STATUSES.includes(profile.accountStatus)) {
        const { error } = await supabase.auth.signOut();

        if (!error) {
          authUserRef.current = null;
          lastKnownRef.current = { role: null, accountStatus: null };
          setSession(null);
          setUser(null);
          window.location.replace("/login");
        }

        return;
      }

      const previous = lastKnownRef.current;

      if (previous.role === profile.role && previous.accountStatus === profile.accountStatus) {
        return;
      }

      if (previous.role && previous.role !== profile.role) {
        console.info(
          `Your account role changed from ${previous.role} to ${profile.role}.`,
        );
      }

      lastKnownRef.current = {
        role: profile.role,
        accountStatus: profile.accountStatus,
      };
      setUser(profile);
    } catch (refreshError) {
      console.warn("Profile refresh failed.", refreshError);
    }
  }, []);

  // Background revalidation, so a role or status change made elsewhere reaches
  // an already-open tab without a reload.
  useEffect(() => {
    const intervalId = window.setInterval(refreshProfile, PROFILE_REVALIDATE_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshProfile();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", refreshProfile);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", refreshProfile);
    };
  }, [refreshProfile]);

  const login = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error("Unable to load the authenticated user.");
    }

    const profile = await fetchUserProfile(data.user);
    setSession(data.session);
    setUser(profile);
    return profile;
  }, []);

  const signup = useCallback(async (email, password, fullName, studentId, accountType = "student") => {
    // Hard clamp: a caller may only ever ask for a plain student or an
    // unapproved staff applicant. Anything else collapses to student, so a
    // crafted request cannot self-assign admin or an approved staff account.
    // The RLS policy independently enforces the same two combinations.
    const isStaffApplicant = accountType === "staff";
    const role = isStaffApplicant ? "staff" : "student";
    const accountStatus = isStaffApplicant ? "pending" : "active";

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          student_id: studentId.trim(),
        },
      },
    });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error("Unable to create the account.");
    }

    if (!data.session) {
      return {
        user: null,
        requiresEmailConfirmation: true,
      };
    }

    const { error: profileError } = await supabase.from("users").insert({
      id: data.user.id,
      role,
      account_status: accountStatus,
      full_name: fullName.trim(),
      student_id: studentId.trim() || null,
      email: data.user.email,
    });

    if (profileError) {
      await supabase.auth.signOut();
      throw profileError;
    }

    const profile = await fetchUserProfile(data.user);
    setSession(data.session);
    setUser(profile);
    return { user: profile, requiresEmailConfirmation: false };
  }, []);

  // Clears the session and the in-memory profile without forcing a navigation,
  // so the caller can route deliberately. A staff applicant uses this to drop
  // the session that signUp() handed them.
  const endSession = useCallback(async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }

    setSession(null);
    setUser(null);
  }, []);

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }

    setSession(null);
    setUser(null);
    window.location.replace("/login");
  }, []);

  const value = useMemo(
    () => ({
      session,
      user,
      loading,
      login,
      signup,
      logout,
      endSession,
      refreshProfile,
    }),
    [session, user, loading, login, signup, logout, endSession, refreshProfile],
  );

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50">
        <div className="text-center">
          <span className="mx-auto block size-7 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
          <p className="mt-4 text-sm font-medium text-slate-500">
            Loading your account...
          </p>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
