// Forgot Password - Request Reset Code
//
// Generates a secure 6-digit verification code, hashes it, stores it with a
// 10-minute expiry, and sends it via email. Returns a generic success message
// regardless of whether the email exists (prevents user enumeration).
//
// Deploy:
//   1. Supabase dashboard -> Edge Functions -> New function -> paste this file
//   2. Settings -> Edge Functions -> Secrets -> add:
//        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//        RESEND_API_KEY (or SMTP credentials for your email provider)
//        RESET_EMAIL_FROM (e.g., "noreply@yourdomain.com")
//        APP_URL (e.g., "https://your-app.com" for email links)
//   3. Deploy

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Generate a cryptographically secure 6-digit numeric code
function generateCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // Generate a number between 100000 and 999999
  return String(100000 + (array[0] % 900000));
}

// Hash the code using Web Crypto API (SHA-256)
async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Send email using Resend (or adapt for your provider)
async function sendResetEmail(
  to: string,
  code: string,
  fromEmail: string,
  apiKey: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: "Your Password Reset Code",
        html: `
          <!DOCTYPE html>
          <html>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px;">Password Reset Request</h1>
              </div>
              <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
                <p style="font-size: 16px; margin-bottom: 20px;">You requested a password reset for your University Mess account. Use the verification code below:</p>
                <div style="background: white; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                  <span style="font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px; font-family: 'Courier New', monospace;">${code}</span>
                </div>
                <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
                  This code expires in <strong>10 minutes</strong>. If you didn't request this, please ignore this email.
                </p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                <p style="font-size: 12px; color: #9ca3af; text-align: center;">University Mess Management System</p>
              </div>
            </body>
          </html>
        `,
        text: `Your password reset code is: ${code}. This code expires in 10 minutes. If you didn't request this, please ignore this email.`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Email service error: ${error}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
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
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESET_EMAIL_FROM") || "noreply@yourdomain.com";

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return respond({ error: "Service not configured" }, 500);
  }

  if (!resendApiKey) {
    console.error("Missing RESEND_API_KEY");
    return respond({ error: "Email service not configured" }, 500);
  }

  let payload: { email?: string };

  try {
    payload = await request.json();
  } catch {
    return respond({ error: "Invalid request body" }, 400);
  }

  const email = String(payload?.email ?? "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return respond({ error: "Valid email is required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Check if user exists in public.users (not auth.users, to respect RLS patterns)
  const { data: user, error: userError } = await admin
    .from("users")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  // Generate code and hash regardless of user existence (prevents enumeration)
  const code = generateCode();
  const codeHash = await hashCode(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  if (user && !userError) {
    // User exists - store the hashed code and expiry
    const { error: updateError } = await admin
      .from("users")
      .update({
        password_reset_token_hash: codeHash,
        password_reset_expires_at: expiresAt,
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("Failed to store reset token", updateError);
      return respond({ error: "Could not process request" }, 500);
    }

    // Send the actual email with the code
    const emailResult = await sendResetEmail(email, code, fromEmail, resendApiKey);
    if (!emailResult.success) {
      console.error("Failed to send reset email", emailResult.error);
      // Don't expose email failure to client - still return success for security
    }
  } else {
    // User doesn't exist - still wait a bit and return generic success
    // This prevents timing attacks for user enumeration
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log(`Password reset requested for non-existent email: ${email}`);
  }

  // Always return the same generic success response
  return respond(
    {
      message: "If an account with that email exists, a password reset code has been sent.",
    },
    200,
  );
});