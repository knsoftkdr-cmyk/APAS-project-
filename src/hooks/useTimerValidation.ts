import { supabase } from "@/integrations/supabase/client";

interface TimerValidationRequest {
  test_id: string;
  student_id: string;
  client_elapsed_time: number;
  submission_time: string;
  expected_duration: number;
}

interface TimerValidationResponse {
  valid: boolean;
  reason?: string;
  time_delta_ms?: number;
  severity?: "none" | "warning" | "violation";
  action?: "accept" | "flag" | "reject";
}

export async function validateTimer(
  request: TimerValidationRequest
): Promise<TimerValidationResponse> {
  try {
    const { data, error } = await supabase.functions.invoke("validate-timer", {
      body: request,
    });

    if (error) {
      console.error("Timer validation error:", error);
      // If validation fails, accept the submission but log it
      return {
        valid: true,
        reason: "Validation service error - accepting submission",
        severity: "warning",
        action: "accept",
      };
    }

    return data as TimerValidationResponse;
  } catch (err) {
    console.error("Timer validation exception:", err);
    return {
      valid: true,
      reason: "Validation service exception - accepting submission",
      severity: "warning",
      action: "accept",
    };
  }
}

/**
 * Hook to check if a submission should be flagged based on timing
 * Returns true if submission should be accepted, false if it should be rejected
 */
export function useTimerValidation() {
  return { validateTimer };
}
