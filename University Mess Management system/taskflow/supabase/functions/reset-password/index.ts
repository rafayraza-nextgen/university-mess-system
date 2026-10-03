// Reset Password - Verify Code & Update Password
//
// Validates the 6-digit code against the stored hash, checks expiry,
// hashes the new password using bcrypt (via Supabase auth), updates the
// user's password, and clears the reset token fields.
//
// Deploy:
//   1. Supabase dashboard -> Edge Functions -> New function -> paste this file
//   2. Settings -> Edge Functions -> Secrets -> add:
//        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   3. Deploy

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Hash the provided code using Web Crypto API (SHA-256) for comparison
async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time comparison to prevent timing attacks
function secureEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);

  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }

  return diff === 0;
}

const respond = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return respond({ error: "Service not configured" }, 500);
  }

  let payload: { email?: string; code?: string; password?: string };

  try {
    payload = await request.json();
  } catch {
    return respond({ error: "Invalid request body" }, 400);
  }

  const email = String(payload?.email ?? "").trim().toLowerCase();
  const code = String(payload?.code ?? "").trim();
  const newPassword = String(payload?.password ?? "");

  // Validate inputs
  if (!email || !email.includes("@")) {
    return respond({ error: "Valid email is required" }, 400);
  }

  if (!code || !/^\d{6}$/.test(code)) {
    return respond({ error: "Valid 6-digit code is required" }, 400);
  }

  if (!newPassword || newPassword.length < 8) {
    return respond({ error: "Password must be at least 8 characters" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch user with reset token fields
  const { data: user, error: userError } = await admin
    .from("users")
    .select("id, email, password_reset_token_hash, password_reset_expires_at")
    .eq("email", email)
    .maybeSingle();

  if (userError) {
    console.error("Database error fetching user", userError);
    return respond({ error: "Could not process request" }, 500);
  }

  if (!user) {
    // User doesn't exist - generic error to prevent enumeration
    return respond({ error: "Invalid or expired reset code" }, 400);
  }

  // Check if reset token exists
  if (!user.password_reset_token_hash || !user.password_reset_expires_at) {
    return respond({ error: "Invalid or expired reset code" }, 400);
  }

  // Check expiry
  const expiresAt = new Date(user.password_reset_expires_at).getTime();
  const now = Date.now();

  if (now > expiresAt) {
    // Token expired - clear it and return error
    await admin
      .from("users")
      .update({
        password_reset_token_hash: null,
        password_reset_expires_at: null,
      })
      .eq("id", user.id);

    return respond({ error: "Reset code has expired. Please request a new one." }, 400);
  }

  // Verify code hash (constant-time comparison)
  const providedCodeHash = await hashCode(code);
  if (!secureEquals(providedCodeHash, user.password_reset_token_hash)) {
    return respond({ error: "Invalid or expired reset code" }, 400);
  }

  // Code is valid - update password via Supabase Auth Admin API
  // This uses Supabase's built-in bcrypt hashing
  const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });

  if (authError) {
    console.error("Failed to update password", authError);
    return respond({ error: "Could not reset password" }, 500);
  }

  // Clear the reset token fields so the code cannot be reused
  const { error: clearError } = await admin
    .from("users")
    .update({
      password_reset_token_hash: null,
      password_reset_expires_at: null,
    })
    .eq("id", user.id);

  if (clearError) {
    console.error("Failed to clear reset token", clearError);
    // Password was changed but token cleanup failed - log but don't fail
    // The expired token will be rejected on next attempt anyway
  }

  return respond({ message: "Password has been reset successfully" }, 200);
});