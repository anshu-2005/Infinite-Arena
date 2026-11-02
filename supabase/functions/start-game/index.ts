import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return respond({ error: "Server is not configured." }, 500);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return respond({ error: "Sign in is required." }, 401);

  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const { data: userData, error: authError } = await authClient.auth.getUser();
  if (authError || !userData.user) return respond({ error: "The sign-in token is invalid." }, 401);

  const body = await request.json().catch(() => null);
  const mode = body && body.mode;
  if (!["infinite", "timed", "daily"].includes(mode)) {
    return respond({ error: "Choose a ranked game mode." }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const userId = userData.user.id;

  if (mode === "daily") {
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing, error: lookupError } = await admin.from("game_sessions")
      .select("id,seed,started_at,expires_at,completed_at")
      .eq("user_id", userId)
      .eq("mode", "daily")
      .eq("challenge_date", today)
      .maybeSingle();
    if (lookupError) return respond({ error: "Could not load today's challenge." }, 500);
    if (existing) {
      if (existing.completed_at) return respond({ error: "Today's ranked challenge has already been submitted." }, 409);
      return respond({
        sessionId: existing.id,
        seed: Number(existing.seed),
        startedAt: new Date(existing.started_at).getTime(),
        expiresAt: existing.expires_at ? new Date(existing.expires_at).getTime() : null
      });
    }
  }

  const now = new Date();
  const { count, error: rateLimitError } = await admin.from("game_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("started_at", new Date(now.getTime() - 60000).toISOString());
  if (rateLimitError) return respond({ error: "Could not check the session limit." }, 500);
  if ((count || 0) >= 10) return respond({ error: "Too many new runs. Try again in a minute." }, 429);

  const dailyDate = mode === "daily" ? now.toISOString().slice(0, 10) : null;
  const seedBuffer = new Uint32Array(1);
  crypto.getRandomValues(seedBuffer);
  const seed = mode === "daily"
    ? Number(dailyDate.replace(/-/g, ""))
    : seedBuffer[0];
  const expiresAt = mode === "timed"
    ? new Date(now.getTime() + 120000).toISOString()
    : null;

  const { data: session, error: insertError } = await admin.from("game_sessions")
    .insert({
      user_id: userId,
      mode: mode,
      seed: seed,
      started_at: now.toISOString(),
      expires_at: expiresAt,
      challenge_date: dailyDate
    })
    .select("id,seed,started_at,expires_at")
    .single();

  if (insertError) {
    if (mode === "daily" && insertError.code === "23505") {
      return respond({ error: "Today's challenge has already been started." }, 409);
    }
    return respond({ error: "Could not start a verified game session." }, 500);
  }

  return respond({
    sessionId: session.id,
    seed: Number(session.seed),
    startedAt: new Date(session.started_at).getTime(),
    expiresAt: session.expires_at ? new Date(session.expires_at).getTime() : null
  });
});
