// Staff self-service signup.
//
// Why this exists: a code check in the React client is not a security control.
// The bundle is public, so anyone can read the code and self-assign admin or
// staff. Row Level Security already blocks a client from writing any role other
// than its own ("users_insert_own_student_profile" requires role = 'student'),
// which is the correct behaviour.
//
// This function performs the privileged write with the service-role key, which
// bypasses RLS by design. That is precisely why it must run server-side and why
// the authorization code is read from an environment variable rather than the
// request.
//
// Deploy:
//   1. Supabase dashboard -> Edge Functions -> New function -> paste this file
//   2. Settings -> Edge Functions -> Secrets -> add:
//        STAFF_SIGNUP_CODE   (the value staff must present)
//   3. Deploy
//
// Student signup needs none of this and still goes through the normal client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Constant-time-ish comparison so the endpoint does not leak the code length or
// a matching prefix through response timing.
const secureEquals = (a, b) => {
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
};

const respond = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const expectedCode = Deno.env.get("STAFF_SIGNUP_CODE");

  if (!supabaseUrl || !serviceRoleKey || !expectedCode) {
    console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or STAFF_SIGNUP_CODE.");
    return respond({ error: "Staff signup is not configured." }, 500);
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return respond({ error: "Invalid request body." }, 400);
  }

  const email = String(payload?.email ?? "").trim().toLowerCase();
  const password = String(payload?.password ?? "");
  const fullName = String(payload?.full_name ?? "").trim();
  const studentId = String(payload?.student_id ?? "").trim();
  const staffCode = String(payload?.staff_code ?? "");

  if (!email || !password || !fullName || !studentId) {
    return respond({ error: "Email, password, name and staff ID are all required." }, 400);
  }

  if (password.length < 8) {
    return respond({ error: "Password must be at least 8 characters." }, 400);
  }

  if (!secureEquals(staffCode.trim().toUpperCase(), expectedCode.trim().toUpperCase())) {
    // Deliberately vague: do not confirm whether a code is partially correct.
    return respond({ error: "Invalid staff authorization code." }, 403);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, student_id: studentId },
  });

  if (createError) {
    // Avoid echoing Supabase's auth error text back to the browser.
    console.warn("Auth user creation failed.", createError.message);
    return respond({ error: "Could not create that account." }, 400);
  }

  const { error: profileError } = await admin.from("users").insert({
    id: created.user.id,
    email,
    full_name: fullName,
    student_id: studentId,
    role: "staff",
  });

  if (profileError) {
    // The auth user exists but has no profile, so it can never sign in to a
    // usable account. Roll it back rather than leaving an orphan behind.
    console.error("Profile insert failed; removing orphaned auth user.", profileError);
    await admin.auth.admin.deleteUser(created.user.id);
    return respond({ error: "Could not create that staff profile." }, 500);
  }

  return respond({ user_id: created.user.id, role: "staff" }, 201);
});
