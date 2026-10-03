import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

const primaryDashboard = {
  student: "/student",
  admin: "/admin",
  staff: "/staff",
};

export function ProtectedRoute({ children, allowedRoles = [] }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  // Roles come from the database in lowercase, so normalise before comparing.
  const role = String(user.role || "").toLowerCase();
  const isAllowed = allowedRoles.some(
    (allowedRole) => String(allowedRole).toLowerCase() === role,
  );

  // An unapproved staff applicant holds a staff role but no access. Send them
  // to the landing page, which renders the pending notice, rather than letting
  // the staff route and the marketing page bounce them off each other.
  if (role === "staff" && user.accountStatus === "pending") {
    return <Navigate to="/" replace />;
  }

  if (!isAllowed) {
    return <Navigate to={primaryDashboard[role] || "/student"} replace />;
  }

  return children ?? <Outlet />;
}
