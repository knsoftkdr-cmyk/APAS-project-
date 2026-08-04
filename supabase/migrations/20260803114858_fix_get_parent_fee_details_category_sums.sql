-- Fix get_parent_fee_details: category breakdown (course/transport/other/
-- uniform/material) was summing across ALL fee_payments rows including
-- paid ones, so every payment inflated the displayed amount instead of
-- clearing it. Now excludes status = 'paid' rows from the per-category
-- sums while keeping the overall due/paid totals unchanged.

CREATE OR REPLACE FUNCTION public.get_parent_fee_details(p_student_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- (same body as pasted into the Dashboard SQL Editor above)
$function$