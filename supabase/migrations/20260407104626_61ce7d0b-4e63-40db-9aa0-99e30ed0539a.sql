
-- Add question_distribution column to diagnostic_requests
ALTER TABLE public.diagnostic_requests ADD COLUMN IF NOT EXISTS question_distribution jsonb DEFAULT NULL;

-- Allow school_admins to update diagnostic_requests (for approvals)
CREATE POLICY "School admins can update diagnostic_requests"
ON public.diagnostic_requests
FOR UPDATE
TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin')
WITH CHECK (get_user_role(auth.uid()) = 'school_admin');

-- Update the notification trigger to also notify school_admins
CREATE OR REPLACE FUNCTION public.notify_diagnostic_request_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  teacher_name text;
  admin_record record;
BEGIN
  SELECT full_name INTO teacher_name FROM profiles WHERE id = NEW.teacher_id;
  
  FOR admin_record IN SELECT id FROM profiles WHERE role IN ('admin', 'school_admin')
  LOOP
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    VALUES (
      admin_record.id,
      'diagnostic_request_submitted',
      'New Diagnostic Request',
      COALESCE(teacher_name, 'A teacher') || ' submitted a diagnostic request for ' || NEW.class_name || ' - ' || NEW.subject,
      NEW.id,
      'diagnostic_request'
    );
  END LOOP;
  
  RETURN NEW;
END;
$function$;

-- Update decided trigger to also work for school_admins
CREATE OR REPLACE FUNCTION public.notify_diagnostic_request_decided()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    VALUES (
      NEW.teacher_id,
      'diagnostic_request_' || NEW.status,
      CASE WHEN NEW.status = 'approved' THEN 'Request Approved' ELSE 'Request Rejected' END,
      'Your diagnostic request for ' || NEW.class_name || ' - ' || NEW.subject || 
        CASE WHEN NEW.status = 'approved' THEN ' was approved with ' || COALESCE(NEW.approved_count::text, '0') || ' questions'
        ELSE ' was rejected. ' || COALESCE(NEW.admin_notes, '') END,
      NEW.id,
      'diagnostic_request'
    );
  END IF;

  IF OLD.status != 'assigned' AND NEW.status = 'assigned' THEN
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    SELECT 
      p.id,
      'diagnostic_questions_assigned',
      'Questions Assigned',
      'Diagnostic questions for ' || NEW.class_name || ' - ' || NEW.subject || ' have been assigned to students',
      NEW.id,
      'diagnostic_request'
    FROM profiles p WHERE p.role IN ('admin', 'school_admin');
  END IF;

  IF OLD.status != 'completed' AND NEW.status = 'completed' THEN
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    VALUES (
      NEW.teacher_id,
      'diagnostic_completed',
      'Diagnostic Completed',
      'Diagnostic for ' || NEW.class_name || ' - ' || NEW.subject || ' has been completed. Results are ready for analysis.',
      NEW.id,
      'diagnostic_request'
    );
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    SELECT 
      p.id,
      'diagnostic_completed',
      'Diagnostic Completed',
      'Diagnostic for ' || NEW.class_name || ' - ' || NEW.subject || ' has been completed.',
      NEW.id,
      'diagnostic_request'
    FROM profiles p WHERE p.role IN ('admin', 'school_admin');
  END IF;

  RETURN NEW;
END;
$function$;
