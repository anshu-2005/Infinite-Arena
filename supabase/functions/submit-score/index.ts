import { createClient } from "npm:@supabase/supabase-js@2";
import { replay } from "../_shared/replay.ts";

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
  if (!body || typeof body.sessionId !== "string" ||
      !Array.isArray(body.moves) || body.moves.length > 20000 ||
      !Number.isSafeInteger(body.score) || body.score < 0) {
    return respond({ error: "The score submission is invalid." }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: session, error: sessionError } = await admin.from("game_sessions")
    .select("id,user_id,mode,seed,started_at,expires_at,challenge_date,completed_at")
    .eq("id", body.sessionId)
    .maybeSingle();

  if (sessionError) return respond({ error: "Could not validate this game session." }, 500);
  if (!session || session.user_id !== userData.user.id || session.mode !== body.mode) {
    return respond({ error: "This game session does not belong to your account." }, 403);
  }
  if (session.completed_at) {
    const { data: savedScore, error: savedScoreError } = await admin.from("scores")
      .select("score,mode")
      .eq("session_id", session.id)
      .maybeSingle();
    if (savedScoreError) return respond({ error: "Could not load the verified score." }, 500);
    if (savedScore && Number(savedScore.score) === body.score && savedScore.mode === session.mode) {
      return respond({ verified: true, score: Number(savedScore.score), mode: savedScore.mode });
    }
    return respond({ error: "This game session was already submitted." }, 409);
  }

  const elapsed = Date.now() - new Date(session.started_at).getTime();
  if (elapsed < 1000) return respond({ error: "The game session ended too quickly." }, 400);
  if (body.moves.some((direction: unknown) =>
    !Number.isInteger(direction) || Number(direction) < 0 || Number(direction) > 3
  )) {
    return respond({ error: "Move history contains an invalid direction." }, 400);
  }
  if (session.mode === "timed" && body.moves.length > 1200) {
    return respond({ error: "The timed run contains too many moves." }, 400);
  }
  if (session.mode !== "timed" && body.moves.length > 20000) {
    return respond({ error: "The run contains too many moves." }, 400);
  }
  if (session.mode === "daily" && session.challenge_date !== new Date().toISOString().slice(0, 10)) {
    return respond({ error: "This daily challenge has expired." }, 409);
  }

  let verified;
  try {
    verified = replay(Number(session.seed), body.moves);
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Move history is invalid." }, 400);
  }

  if (session.mode === "timed" && elapsed < 120000 && !verified.gameOver) {
    return respond({ error: "The timed run has not finished yet." }, 400);
  }

  const timedOut = session.mode === "timed" && session.expires_at &&
    Date.now() >= new Date(session.expires_at).getTime();
  if (!verified.gameOver && !timedOut) {
    return respond({ error: "Submit a run only after no moves remain or the timer ends." }, 400);
  }
  if (verified.score !== body.score) {
    return respond({ error: "The submitted score does not match the verified move history." }, 400);
  }

  const { error: saveError } = await admin.rpc("save_verified_score", {
    p_session_id: session.id,
    p_user_id: session.user_id,
    p_mode: session.mode,
    p_score: verified.score,
    p_move_count: verified.moveCount
  });
  if (saveError) return respond({ error: "Could not save the verified score." }, 500);

  return respond({ verified: true, score: verified.score, mode: session.mode });
});
