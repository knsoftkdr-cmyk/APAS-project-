-- Leaderboard RPC function (only shows students)
CREATE OR REPLACE FUNCTION public.get_leaderboard(
  time_period text DEFAULT 'all-time',
  limit_count integer DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  total_xp integer,
  level integer,
  full_name text,
  avatar_url text
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ug.user_id,
    ug.total_xp,
    ug.level,
    p.full_name,
    p.avatar_url
  FROM public.user_gamification ug
  JOIN public.profiles p ON p.id = ug.user_id
  JOIN public.students s ON s.profile_id = ug.user_id
  WHERE CASE
    WHEN time_period = 'weekly' THEN ug.updated_at >= now() - interval '7 days'
    WHEN time_period = 'monthly' THEN ug.updated_at >= now() - interval '30 days'
    ELSE true
  END
  ORDER BY ug.total_xp DESC
  LIMIT limit_count;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_leaderboard(text, integer) TO authenticated;
