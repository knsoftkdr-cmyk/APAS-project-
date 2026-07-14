import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Users, Heart, MessageCircle, Send, Download, Star,
  Upload, FileText, X,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Post {
  id: string;
  author_id: string;
  content: string;
  group_type: "subject" | "grade" | "general";
  group_value: string | null;
  created_at: string;
  author_name: string;
  like_count: number;
  liked_by_me: boolean;
  comments: { id: string; author_id: string; author_name: string; content: string; created_at: string }[];
}

interface Resource {
  id: string;
  uploaded_by: string;
  uploader_name: string;
  title: string;
  description: string | null;
  file_url: string;
  file_name: string;
  subject: string | null;
  grade: string | null;
  download_count: number;
  avg_rating: number;
  rating_count: number;
  my_rating: number | null;
  created_at: string;
}

const SUBJECTS = ["Mathematics", "Science", "English", "Social Studies", "Computer Science"];
const GRADES = ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8", "Class 9", "Class 10"];

export function TeacherCommunitiesContent() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<"feed" | "resources">("feed");
  const [filterType, setFilterType] = useState<"all" | "subject" | "grade">("all");
  const [filterValue, setFilterValue] = useState<string>("");

  // Feed state
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [newPostContent, setNewPostContent] = useState("");
  const [newPostType, setNewPostType] = useState<"general" | "subject" | "grade">("general");
  const [newPostValue, setNewPostValue] = useState("");
  const [posting, setPosting] = useState(false);
  const [openCommentBox, setOpenCommentBox] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
const [postScope, setPostScope] = useState<"all" | "mine">("all");
const [resourceScope, setResourceScope] = useState<"all" | "mine">("all");
  // Resources state
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadSubject, setUploadSubject] = useState("");
  const [uploadGrade, setUploadGrade] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // ── Fetch feed ──────────────────────────────────────────────────────────────
  const fetchPosts = useCallback(async () => {
    if (!profile?.school_id) return;
    setPostsLoading(true);
    try {
      let query = supabase.from("community_posts").select("*").eq("school_id", profile.school_id);
      if (filterType !== "all") query = query.eq("group_type", filterType);
      if (filterType !== "all" && filterValue) query = query.eq("group_value", filterValue);
      const { data: postRows, error } = await query.order("created_at", { ascending: false }).limit(50);
      if (error) throw error;

      const postIds = (postRows || []).map((p: any) => p.id);
      const authorIds = [...new Set((postRows || []).map((p: any) => p.author_id))];

      const [{ data: likes }, { data: comments }, { data: authors }] = await Promise.all([
        postIds.length ? supabase.from("post_likes").select("post_id, user_id").in("post_id", postIds) : Promise.resolve({ data: [] as any[] }),
        postIds.length ? supabase.from("post_comments").select("*").in("post_id", postIds).order("created_at", { ascending: true }) : Promise.resolve({ data: [] as any[] }),
        authorIds.length ? supabase.from("profiles").select("id, full_name").in("id", authorIds) : Promise.resolve({ data: [] as any[] }),
      ]);

      const commentAuthorIds = [...new Set((comments || []).map((c: any) => c.author_id))];
      const { data: commentAuthors } = commentAuthorIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", commentAuthorIds)
        : { data: [] as any[] };

      const authorMap = new Map((authors || []).map((a: any) => [a.id, a.full_name]));
      const commentAuthorMap = new Map((commentAuthors || []).map((a: any) => [a.id, a.full_name]));

      const merged: Post[] = (postRows || []).map((p: any) => {
        const postLikes = (likes || []).filter((l: any) => l.post_id === p.id);
        const postComments = (comments || [])
          .filter((c: any) => c.post_id === p.id)
          .map((c: any) => ({ ...c, author_name: commentAuthorMap.get(c.author_id) || "Unknown" }));
        return {
          ...p,
          author_name: authorMap.get(p.author_id) || "Unknown",
          like_count: postLikes.length,
          liked_by_me: postLikes.some((l: any) => l.user_id === user?.id),
          comments: postComments,
        };
      });
      setPosts(merged);
    } catch (e: any) {
      toast({ title: "Error loading feed", description: e.message, variant: "destructive" });
    } finally {
      setPostsLoading(false);
    }
  }, [profile?.school_id, user?.id, filterType, filterValue, toast]);

  // ── Fetch resources ──────────────────────────────────────────────────────────
  const fetchResources = useCallback(async () => {
    if (!profile?.school_id) return;
    setResourcesLoading(true);
    try {
      let query = supabase.from("community_resources").select("*").eq("school_id", profile.school_id);
      if (filterType === "subject" && filterValue) query = query.eq("subject", filterValue);
      if (filterType === "grade" && filterValue) query = query.eq("grade", filterValue);
      const { data: resRows, error } = await query.order("created_at", { ascending: false }).limit(50);
      if (error) throw error;

      const resourceIds = (resRows || []).map((r: any) => r.id);
      const uploaderIds = [...new Set((resRows || []).map((r: any) => r.uploaded_by))];

      const [{ data: ratings }, { data: uploaders }] = await Promise.all([
        resourceIds.length ? supabase.from("resource_ratings").select("resource_id, user_id, rating").in("resource_id", resourceIds) : Promise.resolve({ data: [] as any[] }),
        uploaderIds.length ? supabase.from("profiles").select("id, full_name").in("id", uploaderIds) : Promise.resolve({ data: [] as any[] }),
      ]);

      const uploaderMap = new Map((uploaders || []).map((u: any) => [u.id, u.full_name]));

      const merged: Resource[] = (resRows || []).map((r: any) => {
        const resRatings = (ratings || []).filter((rt: any) => rt.resource_id === r.id);
        const avg = resRatings.length ? resRatings.reduce((a: number, b: any) => a + b.rating, 0) / resRatings.length : 0;
        const mine = resRatings.find((rt: any) => rt.user_id === user?.id);
        return {
          ...r,
          uploader_name: uploaderMap.get(r.uploaded_by) || "Unknown",
          avg_rating: avg,
          rating_count: resRatings.length,
          my_rating: mine?.rating ?? null,
        };
      });
      setResources(merged);
    } catch (e: any) {
      toast({ title: "Error loading resources", description: e.message, variant: "destructive" });
    } finally {
      setResourcesLoading(false);
    }
  }, [profile?.school_id, user?.id, filterType, filterValue, toast]);

  useEffect(() => { fetchPosts(); fetchResources(); }, [fetchPosts, fetchResources]);

  // ── Post actions ──────────────────────────────────────────────────────────────
  const handleCreatePost = async () => {
    if (!newPostContent.trim() || !user?.id || !profile?.school_id) return;
    setPosting(true);
    try {
      const { error } = await supabase.from("community_posts").insert({
        school_id: profile.school_id,
        author_id: user.id,
        content: newPostContent.trim(),
        group_type: newPostType,
        group_value: newPostType === "general" ? null : newPostValue || null,
      });
      if (error) throw error;
      setNewPostContent("");
      setNewPostType("general");
      setNewPostValue("");
      fetchPosts();
    } catch (e: any) {
      toast({ title: "Error posting", description: e.message, variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (post: Post) => {
    if (!user?.id) return;
    if (post.liked_by_me) {
      await supabase.from("post_likes").delete().eq("post_id", post.id).eq("user_id", user.id);
    } else {
      await supabase.from("post_likes").insert({ post_id: post.id, user_id: user.id });
    }
    fetchPosts();
  };

  const submitComment = async (postId: string) => {
    const text = commentDrafts[postId]?.trim();
    if (!text || !user?.id) return;
    await supabase.from("post_comments").insert({ post_id: postId, author_id: user.id, content: text });
    setCommentDrafts((prev) => ({ ...prev, [postId]: "" }));
    fetchPosts();
  };

  // ── Resource actions ──────────────────────────────────────────────────────────
  const handleUploadResource = async () => {
    if (!uploadTitle.trim() || !uploadFile || !user?.id || !profile?.school_id) {
      toast({ title: "Title and file are required", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = uploadFile.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("community-resources").upload(path, uploadFile);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("community-resources").getPublicUrl(path);

      const { error } = await supabase.from("community_resources").insert({
        school_id: profile.school_id,
        uploaded_by: user.id,
        title: uploadTitle.trim(),
        description: uploadDesc.trim() || null,
        file_url: urlData.publicUrl,
        file_name: uploadFile.name,
        subject: uploadSubject || null,
        grade: uploadGrade || null,
      });
      if (error) throw error;

      toast({ title: "Resource shared" });
      setUploadOpen(false);
      setUploadTitle(""); setUploadDesc(""); setUploadSubject(""); setUploadGrade(""); setUploadFile(null);
      fetchResources();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (resource: Resource) => {
    const { error } = await supabase.rpc("increment_resource_downloads", { resource_id: resource.id });
    if (error) {
      toast({ title: "Couldn't update download count", description: error.message, variant: "destructive" });
    }
    window.open(resource.file_url, "_blank");
    fetchResources();
  };

  const rateResource = async (resource: Resource, rating: number) => {
    if (!user?.id) return;
    if (resource.my_rating) {
      await supabase.from("resource_ratings").update({ rating }).eq("resource_id", resource.id).eq("user_id", user.id);
    } else {
      await supabase.from("resource_ratings").insert({ resource_id: resource.id, user_id: user.id, rating });
    }
    fetchResources();
  };

  const filterOptions = filterType === "subject" ? SUBJECTS : filterType === "grade" ? GRADES : [];

  return (
    <div className="container mx-auto px-4 py-6 space-y-4 max-w-5xl">
  <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg">
    <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
    <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
    <div className="relative flex items-center gap-3 md:gap-4">
      <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
        <Users className="h-5 w-5 md:h-6 md:w-6 text-white" />
      </div>
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-white">Teacher Communities</h1>
        <p className="text-indigo-100 text-xs md:text-sm mt-0.5">Share ideas, resources, and learn from other teachers in your school</p>
      </div>
    </div>
  </div>

    <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
      <TabsList className="grid grid-cols-2 w-full max-w-xs bg-indigo-50 border border-indigo-100 p-1">
        <TabsTrigger value="feed" className="rounded-md data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Community Feed</TabsTrigger>
        <TabsTrigger value="resources" className="rounded-md data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Resources</TabsTrigger>
      </TabsList>
    </Tabs>

    {/* Group filter */}
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={filterType} onValueChange={(v: any) => { setFilterType(v); setFilterValue(""); }}>
        <SelectTrigger className="w-full sm:w-40 border-indigo-100"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="subject">By Subject</SelectItem>
          <SelectItem value="grade">By Grade</SelectItem>
        </SelectContent>
      </Select>
      {filterType !== "all" && (
        <Select value={filterValue} onValueChange={setFilterValue}>
          <SelectTrigger className="w-full sm:w-44 border-indigo-100"><SelectValue placeholder={`Select ${filterType}`} /></SelectTrigger>
          <SelectContent>
            {filterOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
        {tab === "feed" ? (
  <div className="space-y-4">
    {/* Composer */}
    <Card className="overflow-hidden border-indigo-100 shadow-sm">
  <div className="h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
  <CardContent className="p-4 space-y-3">
    <div className="flex gap-3">
      <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
        {(profile?.full_name || "T")[0]}
      </div>
      <Textarea
        placeholder="Share an idea, ask a question, or post an update..."
        value={newPostContent}
        onChange={(e) => setNewPostContent(e.target.value)}
        rows={3}
        className="border-slate-200 focus-visible:ring-indigo-400"
      />
    </div>
    <div className="flex items-center gap-2 flex-wrap pl-0 sm:pl-12">
      <Select value={newPostType} onValueChange={(v: any) => { setNewPostType(v); setNewPostValue(""); }}>
        <SelectTrigger className="w-full xs:w-36 sm:w-36 border-slate-200"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="general">General</SelectItem>
          <SelectItem value="subject">Subject</SelectItem>
          <SelectItem value="grade">Grade</SelectItem>
        </SelectContent>
      </Select>
      {newPostType !== "general" && (
        <Select value={newPostValue} onValueChange={setNewPostValue}>
          <SelectTrigger className="w-full sm:w-44 border-slate-200"><SelectValue placeholder={`Select ${newPostType}`} /></SelectTrigger>
          <SelectContent>
            {(newPostType === "subject" ? SUBJECTS : GRADES).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Button
        size="sm"
        className="ml-auto bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700"
        onClick={handleCreatePost}
        disabled={posting}
      >
        <Send className="h-3.5 w-3.5 mr-1.5" /> {posting ? "Posting..." : "Post"}
      </Button>
    </div>
  </CardContent>
</Card>

{/* All Posts / My Posts toggle — sits above the feed list */}
<div className="flex items-center justify-between flex-wrap gap-2">
  <div className="flex gap-1 bg-indigo-50 border border-indigo-100 p-1 rounded-full">
    <button
      onClick={() => setPostScope("all")}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
        postScope === "all" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      All Posts
    </button>
    <button
      onClick={() => setPostScope("mine")}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
        postScope === "mine" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      My Posts
    </button>
  </div>
</div>

{/* Feed */}
{postsLoading ? (
  <div className="flex justify-center py-8"><LoadingSpinner /></div>
) : (() => {
  const visiblePosts = postScope === "mine" ? posts.filter((p) => p.author_id === user?.id) : posts;
  if (visiblePosts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        {postScope === "mine" ? "You haven't posted anything yet." : "No posts yet — be the first to share something."}
      </p>
    );
  }
  return visiblePosts.map((post) => {
  const groupColor =
    post.group_type === "subject" ? "bg-blue-100 text-blue-700" :
    post.group_type === "grade" ? "bg-emerald-100 text-emerald-700" :
    "bg-slate-100 text-slate-600";
  const isMine = post.author_id === user?.id;
  return (
    <Card
      key={post.id}
      className={`shadow-sm hover:shadow-md transition-shadow ${
        isMine ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200"
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ring-2 ${
              isMine ? "bg-gradient-to-br from-indigo-600 to-violet-600 ring-indigo-300" : "bg-gradient-to-br from-slate-400 to-slate-500 ring-slate-100"
            }`}>
              {post.author_name[0]}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-slate-800 truncate">{post.author_name}</p>
                {isMine && (
                  <span className="text-[9px] font-semibold bg-indigo-600 text-white px-1.5 py-0.5 rounded-full shrink-0">You</span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">{format(new Date(post.created_at), "d MMM, h:mm a")}</p>
            </div>
          </div>
          {post.group_value && <Badge className={`${groupColor} hover:opacity-90 shrink-0`}>{post.group_value}</Badge>}
        </div>
        <p className="text-sm whitespace-pre-line mb-3 text-slate-700 leading-relaxed">{post.content}</p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground border-t border-slate-100 pt-2">
          <button
            onClick={() => toggleLike(post)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors",
              post.liked_by_me && "text-red-600 bg-red-50"
            )}
          >
            <Heart className={cn("h-3.5 w-3.5", post.liked_by_me && "fill-current")} /> {post.like_count} Like{post.like_count === 1 ? "" : "s"}
          </button>
          <button
            onClick={() => setOpenCommentBox(openCommentBox === post.id ? null : post.id)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
          >
            <MessageCircle className="h-3.5 w-3.5" /> {post.comments.length} Repl{post.comments.length === 1 ? "y" : "ies"}
          </button>
        </div>
        {openCommentBox === post.id && (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            {post.comments.map((c) => (
              <div key={c.id} className="flex gap-2 text-xs">
                <div className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-700 shrink-0">
                  {c.author_name[0]}
                </div>
                <div className="bg-slate-50 rounded-xl px-3 py-2 flex-1">
                  <span className="font-semibold text-slate-700">{c.author_name}</span>
                  <span className="text-slate-600"> {c.content}</span>
                </div>
              </div>
            ))}
            <div className="flex gap-2 pl-8">
              <Input
                placeholder="Write a reply..."
                value={commentDrafts[post.id] || ""}
                onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") submitComment(post.id); }}
                className="text-sm h-8 border-slate-200 focus-visible:ring-indigo-400"
              />
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 shrink-0" onClick={() => submitComment(post.id)}>Reply</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
  });
})()}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Upload */}
            {!uploadOpen ? (
  <Button
    className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white"
    onClick={() => setUploadOpen(true)}
  >
    <Upload className="h-4 w-4 mr-1.5" /> Share a Resource
  </Button>
) : (
  <Card className="overflow-hidden border-indigo-100 shadow-sm">
    <div className="h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
    <CardContent className="p-4 space-y-3">
                  <Input placeholder="Title (e.g. Fraction Lesson Plan)" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} />
                  <Textarea placeholder="Description (optional)" value={uploadDesc} onChange={(e) => setUploadDesc(e.target.value)} rows={2} />
                  <div className="flex gap-2">
                    <Select value={uploadSubject} onValueChange={setUploadSubject}>
                      <SelectTrigger><SelectValue placeholder="Subject (optional)" /></SelectTrigger>
                      <SelectContent>{SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={uploadGrade} onValueChange={setUploadGrade}>
                      <SelectTrigger><SelectValue placeholder="Grade (optional)" /></SelectTrigger>
                      <SelectContent>{GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  />
                  {uploadFile ? (
  <div className="flex items-center gap-2 text-sm bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
    <FileText className="h-4 w-4 text-indigo-600" /> {uploadFile.name}
    <button onClick={() => setUploadFile(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
  </div>
) : (
  <Button variant="outline" size="sm" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50" onClick={() => fileInputRef.current?.click()}>
    <Upload className="h-3.5 w-3.5 mr-1.5" /> Choose File
  </Button>
)}
<div className="flex gap-2 flex-wrap">
  <Button className="flex-1 sm:flex-none bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700" onClick={handleUploadResource} disabled={uploading}>
    {uploading ? "Uploading..." : "Share"}
  </Button>
  <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setUploadOpen(false)}>Cancel</Button>
</div>
                </CardContent>
              </Card>
            )}

            {/* All Resources / My Resources toggle — sits above the resource list */}
<div className="flex items-center justify-between flex-wrap gap-2">
  <div className="flex gap-1 bg-amber-50 border border-amber-100 p-1 rounded-full">
    <button
      onClick={() => setResourceScope("all")}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
        resourceScope === "all" ? "bg-amber-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      All Resources
    </button>
    <button
      onClick={() => setResourceScope("mine")}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
        resourceScope === "mine" ? "bg-amber-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      My Resources
    </button>
  </div>
</div>

{/* Resource list */}
{resourcesLoading ? (
  <div className="flex justify-center py-8"><LoadingSpinner /></div>
) : (() => {
  const visibleResources = resourceScope === "mine" ? resources.filter((r) => r.uploaded_by === user?.id) : resources;
  if (visibleResources.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        {resourceScope === "mine" ? "You haven't shared any resources yet." : "No resources shared yet."}
      </p>
    );
  }
  return visibleResources.map((r) => {
  const isMine = r.uploaded_by === user?.id;
  return (
  <Card
    key={r.id}
    className={`overflow-hidden shadow-sm hover:shadow-md transition-shadow ${
      isMine ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200"
    }`}
  >
    <div className={`h-1 bg-gradient-to-r ${isMine ? "from-indigo-500 to-violet-500" : "from-amber-400 to-orange-500"}`} />
    <CardContent className="p-4">
      <div className="flex items-start justify-between mb-1 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isMine ? "bg-indigo-100" : "bg-amber-100"}`}>
            <FileText className={`h-4 w-4 ${isMine ? "text-indigo-600" : "text-amber-600"}`} />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{r.title}</p>
            {isMine && (
              <span className="text-[9px] font-semibold bg-indigo-600 text-white px-1.5 py-0.5 rounded-full shrink-0">You</span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {r.subject && <Badge className="text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-100">{r.subject}</Badge>}
          {r.grade && <Badge className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{r.grade}</Badge>}
        </div>
      </div>
      {r.description && <p className="text-xs text-muted-foreground mb-2 ml-11">{r.description}</p>}
      <p className="text-[10px] text-muted-foreground mb-2 ml-11">Uploaded by {r.uploader_name}</p>

      <div className="flex items-center gap-3 mb-3 ml-11 flex-wrap">
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} onClick={() => rateResource(r, n)} title={r.my_rating ? `Your rating: ${r.my_rating}` : "Click to rate"}>
        <Star
          className={cn(
            "h-3.5 w-3.5 transition-colors",
            r.my_rating && r.my_rating >= n
              ? "fill-amber-400 text-amber-400"
              : "text-slate-300 hover:text-amber-300"
          )}
        />
      </button>
    ))}
    
  </div>
  <span className="text-xs text-muted-foreground">
    {r.avg_rating > 0 ? r.avg_rating.toFixed(1) : "—"} ({r.rating_count})
  </span>
  <span className="text-xs text-muted-foreground">· {r.download_count} downloads</span>
</div>

      <Button
        size="sm"
        variant="outline"
        className={`ml-11 ${isMine ? "border-indigo-200 text-indigo-700 hover:bg-indigo-50" : "border-amber-200 text-amber-700 hover:bg-amber-50"}`}
        onClick={() => handleDownload(r)}
      >
        <Download className="h-3.5 w-3.5 mr-1.5" /> Download
      </Button>
    </CardContent>
  </Card>
  );
  });
})()}
          </div>
        )}
      </div>
  );
}

// Standalone page wrapper — used only if you keep a direct route to this page.
export default function TeacherCommunities() {
  return (
    <AppLayout>
      <TeacherCommunitiesContent />
    </AppLayout>
  );
}
