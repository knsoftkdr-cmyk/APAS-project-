import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TimerValidationRequest {
  test_id: string;
  student_id: string;
  client_elapsed_time: number; // milliseconds
  submission_time: string; // ISO timestamp
  expected_duration: number; // milliseconds
}

interface TimerValidationResponse {
  valid: boolean;
  reason?: string;
  time_delta_ms?: number;
  severity?: "none" | "warning" | "violation";
  action?: "accept" | "flag" | "reject";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body: TimerValidationRequest = await req.json();
    const {
      test_id,
      student_id,
      client_elapsed_time,
      submission_time,
      expected_duration,
    } = body;

    // Validate required fields
    if (!test_id || !student_id || !submission_time || !expected_duration) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get test start time from database
    const { data: testData, error: testError } = await supabase
      .from("academic_tests")
      .select("completed_at, created_at")
      .eq("id", test_id)
      .eq("student_id", student_id)
      .single();

    if (testError || !testData) {
      return new Response(
        JSON.stringify({ error: "Test record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate server-side elapsed time
    const testStartTime = new Date(testData.created_at).getTime();
    const submissionTime = new Date(submission_time).getTime();
    const serverElapsedTime = submissionTime - testStartTime;

    // Calculate time delta (difference between client and server measurements)
    const timeDelta = Math.abs(serverElapsedTime - client_elapsed_time);
    
    // Allowed tolerance: 5 seconds (5000ms)
    const tolerance = 5000;
    
    // Check if timer is suspiciously fast (< 30% of expected duration)
    const tooFast = client_elapsed_time < expected_duration * 0.3;
    
    // Check for significant time discrepancy
    const timeTampered = timeDelta > tolerance * 2; // 10 second discrepancy = likely tamper

    let validation: TimerValidationResponse = {
      valid: true,
      time_delta_ms: timeDelta,
      severity: "none",
      action: "accept",
    };

    // Violation: Completed way too fast
    if (tooFast) {
      validation = {
        valid: false,
        reason: "Test completed suspiciously fast. Possible rushing or technical issue.",
        time_delta_ms: timeDelta,
        severity: "violation",
        action: "flag",
      };
    }
    // Violation: Timer tampered with
    else if (timeTampered) {
      validation = {
        valid: false,
        reason: "Large discrepancy between client and server timers. Possible timer manipulation.",
        time_delta_ms: timeDelta,
        severity: "violation",
        action: "flag",
      };
    }
    // Warning: Minor discrepancy (network lag, clock drift)
    else if (timeDelta > tolerance) {
      validation = {
        valid: true,
        reason: "Minor time discrepancy detected (likely network lag). Accepting but flagging for review.",
        time_delta_ms: timeDelta,
        severity: "warning",
        action: "accept",
      };
    }

    // Log the validation attempt
    const { error: logError } = await supabase.from("timer_validations").insert({
      test_id,
      student_id,
      client_elapsed_ms: client_elapsed_time,
      server_elapsed_ms: serverElapsedTime,
      time_delta_ms: timeDelta,
      is_valid: validation.valid,
      severity: validation.severity,
      action_taken: validation.action,
      details: validation.reason,
    });

    if (logError) console.error("Failed to log validation:", logError);

    return new Response(JSON.stringify(validation), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Timer validation error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
