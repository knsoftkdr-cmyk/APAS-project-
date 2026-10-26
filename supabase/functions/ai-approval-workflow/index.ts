// // AI Content Approval Workflow Manager
// // Handles submission, review, and approval of AI-generated content

// import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// const corsHeaders = {
//   "Access-Control-Allow-Origin": "*",
//   "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
// };

// serve(async (req) => {
//   if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

//   try {
//     const supabase = createClient(
//       Deno.env.get("SUPABASE_URL")!,
//       Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
//     );

//     const authHeader = req.headers.get("authorization");
//     const userIdMatch = authHeader?.match(/user_id=([^&]+)/);
//     const userId = userIdMatch ? userIdMatch[1] : null;

//     if (!userId) {
//       return new Response(
//         JSON.stringify({ error: "Unauthorized" }),
//         { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
//       );
//     }

//     const body = await req.json();
//     const { action } = body;

//     // SUBMIT: Teacher submits AI-generated content for approval
//     if (action === "submit_for_approval") {
//       const {
//         content_id,
//         content_type,
//         generated_content,
//         generated_by_model,
//         confidence_score,
//         quality_issues = {},
//       } = body;

//       if (!["lesson_plan", "mcq", "suggestion", "feedback"].includes(content_type)) {
//         return new Response(
//           JSON.stringify({ error: "Invalid content_type" }),
//           { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
//         );
//       }

//       const { data: queueItem, error } = await supabase
//         .from("ai_content_approval_queue")
//         .insert({
//           content_id,
//           content_type,
//           generated_by_model,
//           generated_content,
//           generated_by_user_id: userId,
//           submitted_by_user_id: userId,
//           status: "pending",
//           confidence_score: confidence_score || 0.75,
//           quality_issues,
//         })
//         .select()
//         .single();

//       if (error) throw error;

//       return new Response(
//         JSON.stringify({
//           message: "Content submitted for approval",
//           queue_id: queueItem.id,
//           status: "pending",
//         }),
//         { headers: { ...corsHeaders, "Content-Type": "application/json" } }
//       );
//     }

//     // GET PENDING: Admins retrieve pending items for review
//     if (action === "get_pending_approvals") {
//       const { content_type = null, limit = 20 } = body;

//       let query = supabase
//         .from("ai_content_approval_queue")
//         .select("*")
//         .eq("status", "pending")
//         .order("created_at", { ascending: true })
//         .limit(limit);

//       if (content_type) {
//         query = query.eq("content_type", content_type);
//       }

//       const { data: items, error } = await query;
//       if (error) throw error;

//       return new Response(
//         JSON.stringify({
//           pending_count: items.length,
//           items,
//         }),
//         { headers: { ...corsHeaders, "Content-Type": "application/json" } }
//       );
//     }

//     // APPROVE: Admin approves AI content
//     if (action === "approve_content") {
//       const { queue_id, reviewer_notes = "" } = body;

//       const { error } = await supabase
//         .from("ai_content_approval_queue")
//         .update({
//           status: "approved",
//           reviewer_id: userId,
//           reviewer_notes,
//           approved_at: new Date().toISOString(),
//         })
//         .eq("id", queue_id);

//       if (error) throw error;

//       // Log success event
//       console.log(`Content approved: ${queue_id} by ${userId}`);

//       return new Response(
//         JSON.stringify({ message: "Content approved successfully" }),
//         { headers: { ...corsHeaders, "Content-Type": "application/json" } }
//       );
//     }

//     // REJECT: Admin rejects AI content
//     if (action === "reject_content") {
//       const { queue_id, reviewer_notes = "" } = body;

//       const { error } = await supabase
//         .from("ai_content_approval_queue")
//         .update({
//           status: "rejected",
//           reviewer_id: userId,
//           reviewer_notes,
//         })
//         .eq("id", queue_id);

//       if (error) throw error;

//       return new Response(
//         JSON.stringify({ message: "Content rejected" }),
//         { headers: { ...corsHeaders, "Content-Type": "application/json" } }
//       );
//     }

//     // REQUEST REVISION: Ask for content improvements
//     if (action === "request_revision") {
//       const { queue_id, quality_issues = {}, reviewer_notes = "" } = body;

//       const { error } = await supabase
//         .from("ai_content_approval_queue")
//         .update({
//           status: "needs_revision",
//           quality_issues,
//           reviewer_id: userId,
//           reviewer_notes,
//         })
//         .eq("id", queue_id);

//       if (error) throw error;

//       return new Response(
//         JSON.stringify({ message: "Revision requested" }),
//         { headers: { ...corsHeaders, "Content-Type": "application/json" } }
//       );
//     }

//     // GET STATS: Approval workflow statistics
//     if (action === "get_approval_stats") {
//       const { days = 30 } = body;
//       const startDate = new Date();
//       startDate.setDate(startDate.getDate() - days);

//       const { data: allItems } = await supabase
//         .from("ai_content_approval_queue")
//         .select("*")
//         .gte("created_at", startDate.toISOString());

//       if (!allItems) {
//         return new Response(
//           JSON.stringify({
//             total: 0,
//             approved: 0,
//             rejected: 0,
//             pending: 0,
//             needs_revision: 0,
//             approval_rate: 0,
//           }),
//           { headers: { ...corsHeaders, "Content-Type": "application/json" } }
//         );
//       }

//       const stats = {
//         total: allItems.length,
//         approved: allItems.filter((i: any) => i.status === "approved").length,
//         rejected: allItems.filter((i: any) => i.status === "rejected").length,
//         pending: allItems.filter((i: any) => i.status === "pending").length,
//         needs_revision: allItems.filter((i: any) => i.status === "needs_revision").length,
//         by_content_type: {} as Record<string, number>,
//         by_model: {} as Record<string, number>,
//         avg_confidence: 0,
//       };

//       // Count by content type
//       allItems.forEach((item: any) => {
//         stats.by_content_type[item.content_type] =
//           (stats.by_content_type[item.content_type] || 0) + 1;
//         stats.by_model[item.generated_by_model] =
//           (stats.by_model[item.generated_by_model] || 0) + 1;
//       });

//       // Calculate average confidence
//       const avgConf = allItems.reduce((sum: number, i: any) => sum + (i.confidence_score || 0), 0);
//       stats.avg_confidence = allItems.length > 0 ? (avgConf / allItems.length).toFixed(3) : 0;

//       const approvalRate =
//         stats.approved > 0 ? ((stats.approved / (stats.approved + stats.rejected)) * 100).toFixed(1) : 0;

//       return new Response(
//         JSON.stringify({
//           ...stats,
//           approval_rate: `${approvalRate}%`,
//           period_days: days,
//         }),
//         { headers: { ...corsHeaders, "Content-Type": "application/json" } }
//       );
//     }

//     return new Response(
//       JSON.stringify({ error: "Unknown action" }),
//       { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
//     );
//   } catch (e) {
//     console.error("Approval workflow error:", e);
//     return new Response(
//       JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
//       { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
//     );
//   }
// });



// AI Content Approval Workflow Manager
// Handles submission, review, and approval of AI-generated content
// Security: verifies the real login token, checks role, and limits everything to the caller's own school.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REVIEWER_ROLES = ["admin", "principal", "school_admin"];
const SUBMITTER_ROLES = ["teacher", "hod", "principal", "school_admin", "admin"];
const REVIEWER_ACTIONS = [
  "get_pending_approvals",
  "approve_content",
  "reject_content",
  "request_revision",
  "get_approval_stats",
];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Verify the real login token
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    // 2. Role and school come from the database, not from the request
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, school_id")
      .eq("id", userId)
      .maybeSingle();

    if (!profile?.school_id) return json({ error: "No school linked to this account" }, 403);
    const role: string = profile.role;
    const schoolId: string = profile.school_id;

    const body = await req.json();
    const { action } = body;

    if (REVIEWER_ACTIONS.includes(action) && !REVIEWER_ROLES.includes(role)) {
      return json({ error: "Not permitted" }, 403);
    }
    if (action === "submit_for_approval" && !SUBMITTER_ROLES.includes(role)) {
      return json({ error: "Not permitted" }, 403);
    }

    // Helpers: everything is limited to the caller's school
    const getSchoolUserIds = async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("school_id", schoolId)
        .limit(5000);
      if (error) throw error;
      return (data || []).map((p: any) => p.id);
    };

    const itemInMySchool = async (queueId: unknown): Promise<boolean> => {
      if (typeof queueId !== "string" || !queueId) return false;
      const { data: item } = await supabase
        .from("ai_content_approval_queue")
        .select("submitted_by_user_id")
        .eq("id", queueId)
        .maybeSingle();
      if (!item?.submitted_by_user_id) return false;
      const { data: submitter } = await supabase
        .from("profiles")
        .select("school_id")
        .eq("id", item.submitted_by_user_id)
        .maybeSingle();
      return submitter?.school_id === schoolId;
    };

    // SUBMIT: Teacher submits AI-generated content for approval
    if (action === "submit_for_approval") {
      const {
        content_id,
        content_type,
        generated_content,
        generated_by_model,
        confidence_score,
        quality_issues = {},
      } = body;

      if (!["lesson_plan", "mcq", "suggestion", "feedback"].includes(content_type)) {
        return json({ error: "Invalid content_type" }, 400);
      }

      const { data: queueItem, error } = await supabase
        .from("ai_content_approval_queue")
        .insert({
          content_id,
          content_type,
          generated_by_model,
          generated_content,
          generated_by_user_id: userId,
          submitted_by_user_id: userId,
          status: "pending",
          confidence_score: confidence_score || 0.75,
          quality_issues,
        })
        .select()
        .single();

      if (error) throw error;

      return json({
        message: "Content submitted for approval",
        queue_id: queueItem.id,
        status: "pending",
      });
    }

    // GET PENDING: reviewers see pending items of their own school only
    if (action === "get_pending_approvals") {
      const { content_type = null } = body;
      const limit = clamp(body.limit, 1, 100, 20);
      const schoolUserIds = await getSchoolUserIds();

      if (schoolUserIds.length === 0) return json({ pending_count: 0, items: [] });

      let query = supabase
        .from("ai_content_approval_queue")
        .select("*")
        .eq("status", "pending")
        .in("submitted_by_user_id", schoolUserIds)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (content_type) {
        query = query.eq("content_type", content_type);
      }

      const { data: items, error } = await query;
      if (error) throw error;

      return json({ pending_count: (items || []).length, items: items || [] });
    }

    // APPROVE
    if (action === "approve_content") {
      const { queue_id, reviewer_notes = "" } = body;
      if (!(await itemInMySchool(queue_id))) return json({ error: "Item not found" }, 404);

      const { error } = await supabase
        .from("ai_content_approval_queue")
        .update({
          status: "approved",
          reviewer_id: userId,
          reviewer_notes,
          approved_at: new Date().toISOString(),
        })
        .eq("id", queue_id);

      if (error) throw error;

      console.log(`Content approved: ${queue_id} by ${userId}`);
      return json({ message: "Content approved successfully" });
    }

    // REJECT
    if (action === "reject_content") {
      const { queue_id, reviewer_notes = "" } = body;
      if (!(await itemInMySchool(queue_id))) return json({ error: "Item not found" }, 404);

      const { error } = await supabase
        .from("ai_content_approval_queue")
        .update({
          status: "rejected",
          reviewer_id: userId,
          reviewer_notes,
        })
        .eq("id", queue_id);

      if (error) throw error;

      return json({ message: "Content rejected" });
    }

    // REQUEST REVISION
    if (action === "request_revision") {
      const { queue_id, quality_issues = {}, reviewer_notes = "" } = body;
      if (!(await itemInMySchool(queue_id))) return json({ error: "Item not found" }, 404);

      const { error } = await supabase
        .from("ai_content_approval_queue")
        .update({
          status: "needs_revision",
          quality_issues,
          reviewer_id: userId,
          reviewer_notes,
        })
        .eq("id", queue_id);

      if (error) throw error;

      return json({ message: "Revision requested" });
    }

    // GET STATS: own school only
    if (action === "get_approval_stats") {
      const days = clamp(body.days, 1, 365, 30);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const schoolUserIds = await getSchoolUserIds();

      const emptyStats = {
        total: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
        needs_revision: 0,
        by_content_type: {},
        by_model: {},
        avg_confidence: 0,
        approval_rate: "0%",
        period_days: days,
      };

      if (schoolUserIds.length === 0) return json(emptyStats);

      const { data: allItems } = await supabase
        .from("ai_content_approval_queue")
        .select("*")
        .in("submitted_by_user_id", schoolUserIds)
        .gte("created_at", startDate.toISOString());

      if (!allItems || allItems.length === 0) return json(emptyStats);

      const stats = {
        total: allItems.length,
        approved: allItems.filter((i: any) => i.status === "approved").length,
        rejected: allItems.filter((i: any) => i.status === "rejected").length,
        pending: allItems.filter((i: any) => i.status === "pending").length,
        needs_revision: allItems.filter((i: any) => i.status === "needs_revision").length,
        by_content_type: {} as Record<string, number>,
        by_model: {} as Record<string, number>,
        avg_confidence: "0" as string | number,
      };

      allItems.forEach((item: any) => {
        stats.by_content_type[item.content_type] =
          (stats.by_content_type[item.content_type] || 0) + 1;
        stats.by_model[item.generated_by_model] =
          (stats.by_model[item.generated_by_model] || 0) + 1;
      });

      const confSum = allItems.reduce((sum: number, i: any) => sum + (i.confidence_score || 0), 0);
      stats.avg_confidence = (confSum / allItems.length).toFixed(3);

      const decided = stats.approved + stats.rejected;
      const approvalRate = decided > 0 ? ((stats.approved / decided) * 100).toFixed(1) : "0";

      return json({
        ...stats,
        approval_rate: `${approvalRate}%`,
        period_days: days,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("Approval workflow error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});