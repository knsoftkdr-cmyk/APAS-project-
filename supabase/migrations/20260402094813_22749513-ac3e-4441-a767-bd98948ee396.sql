
-- Governance notifications table
CREATE TABLE public.governance_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  reference_id uuid,
  reference_type text,
  channel text NOT NULL DEFAULT 'in_app',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.governance_notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY "Users can read own notifications"
  ON public.governance_notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can update own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON public.governance_notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- System can insert notifications (via triggers/admin)
CREATE POLICY "Admins can insert notifications"
  ON public.governance_notifications FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers can insert notifications"
  ON public.governance_notifications FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role(auth.uid()) = 'teacher');

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.governance_notifications;

-- Function to notify admins when a teacher submits a diagnostic request
CREATE OR REPLACE FUNCTION public.notify_diagnostic_request_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  teacher_name text;
  admin_record record;
BEGIN
  SELECT full_name INTO teacher_name FROM profiles WHERE id = NEW.teacher_id;
  
  FOR admin_record IN SELECT id FROM profiles WHERE role = 'admin'
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
$$;

CREATE TRIGGER trg_diagnostic_request_submitted
  AFTER INSERT ON diagnostic_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_diagnostic_request_submitted();

-- Function to notify teacher when admin approves/rejects
CREATE OR REPLACE FUNCTION public.notify_diagnostic_request_decided()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Notify when questions are assigned
  IF OLD.status != 'assigned' AND NEW.status = 'assigned' THEN
    -- Notify all admins
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    SELECT 
      p.id,
      'diagnostic_questions_assigned',
      'Questions Assigned',
      'Diagnostic questions for ' || NEW.class_name || ' - ' || NEW.subject || ' have been assigned to students',
      NEW.id,
      'diagnostic_request'
    FROM profiles p WHERE p.role = 'admin';
  END IF;

  -- Notify when diagnostic is completed
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
    -- Notify admins too
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    SELECT 
      p.id,
      'diagnostic_completed',
      'Diagnostic Completed',
      'Diagnostic for ' || NEW.class_name || ' - ' || NEW.subject || ' has been completed.',
      NEW.id,
      'diagnostic_request'
    FROM profiles p WHERE p.role = 'admin';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_diagnostic_request_decided
  AFTER UPDATE ON diagnostic_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_diagnostic_request_decided();
