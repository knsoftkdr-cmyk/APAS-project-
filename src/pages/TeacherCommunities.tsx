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
    <div className="container mx-auto px-4 py-6 space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Teacher Communities</h1>
          <p className="text-sm text-muted-foreground">Share ideas, resources, and learn from other teachers in your school</p>
        </div>
      </div>

        <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
          <TabsList className="grid grid-cols-2 w-full max-w-xs">
            <TabsTrigger value="feed">Community Feed</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Group filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filterType} onValueChange={(v: any) => { setFilterType(v); setFilterValue(""); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="subject">By Subject</SelectItem>
              <SelectItem value="grade">By Grade</SelectItem>
            </SelectContent>
          </Select>
          {filterType !== "all" && (
            <Select value={filterValue} onValueChange={setFilterValue}>
              <SelectTrigger className="w-44"><SelectValue placeholder={`Select ${filterType}`} /></SelectTrigger>
              <SelectContent>
                {filterOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>

        {tab === "feed" ? (
          <div className="space-y-4">
            {/* Composer */}
            <Card className="border border-border/60">
              <CardContent className="p-4 space-y-3">
                <Textarea
                  placeholder="Share an idea, ask a question, or post an update..."
                  value={newPostContent}
                  onChange={(e) => setNewPostContent(e.target.value)}
                  rows={3}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={newPostType} onValueChange={(v: any) => { setNewPostType(v); setNewPostValue(""); }}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="subject">Subject</SelectItem>
                      <SelectItem value="grade">Grade</SelectItem>
                    </SelectContent>
                  </Select>
                  {newPostType !== "general" && (
                    <Select value={newPostValue} onValueChange={setNewPostValue}>
                      <SelectTrigger className="w-44"><SelectValue placeholder={`Select ${newPostType}`} /></SelectTrigger>
                      <SelectContent>
                        {(newPostType === "subject" ? SUBJECTS : GRADES).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <Button size="sm" className="ml-auto" onClick={handleCreatePost} disabled={posting}>
                    <Send className="h-3.5 w-3.5 mr-1.5" /> {posting ? "Posting..." : "Post"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Feed */}
            {postsLoading ? (
              <div className="flex justify-center py-8"><LoadingSpinner /></div>
            ) : posts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No posts yet — be the first to share something.</p>
            ) : (
              posts.map((post) => (
                <Card key={post.id} className="border border-border/60">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">
                          {post.author_name[0]}
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{post.author_name}</p>
                          <p className="text-[10px] text-muted-foreground">{format(new Date(post.created_at), "d MMM, h:mm a")}</p>
                        </div>
                      </div>
                      {post.group_value && <Badge variant="secondary">{post.group_value}</Badge>}
                    </div>
                    <p className="text-sm whitespace-pre-line mb-3">{post.content}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-2">
                      <button
                        onClick={() => toggleLike(post)}
                        className={cn("flex items-center gap-1.5 hover:text-red-600 transition-colors", post.liked_by_me && "text-red-600")}
                      >
                        <Heart className={cn("h-3.5 w-3.5", post.liked_by_me && "fill-current")} /> {post.like_count} Like{post.like_count === 1 ? "" : "s"}
                      </button>
                      <button
                        onClick={() => setOpenCommentBox(openCommentBox === post.id ? null : post.id)}
                        className="flex items-center gap-1.5 hover:text-blue-600 transition-colors"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> {post.comments.length} Repl{post.comments.length === 1 ? "y" : "ies"}
                      </button>
                    </div>
                    {openCommentBox === post.id && (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        {post.comments.map((c) => (
                          <div key={c.id} className="text-xs bg-muted/40 rounded-lg p-2.5">
                            <span className="font-semibold">{c.author_name}: </span>
                            <span>{c.content}</span>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <Input
                            placeholder="Write a reply..."
                            value={commentDrafts[post.id] || ""}
                            onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") submitComment(post.id); }}
                            className="text-sm h-8"
                          />
                          <Button size="sm" onClick={() => submitComment(post.id)}>Reply</Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Upload */}
            {!uploadOpen ? (
              <Button variant="outline" className="w-full" onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4 mr-1.5" /> Share a Resource
              </Button>
            ) : (
              <Card className="border border-border/60">
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
                    <div className="flex items-center gap-2 text-sm bg-muted rounded-lg px-3 py-2">
                      <FileText className="h-4 w-4" /> {uploadFile.name}
                      <button onClick={() => setUploadFile(null)}><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5 mr-1.5" /> Choose File
                    </Button>
                  )}
                  <div className="flex gap-2">
                    <Button onClick={handleUploadResource} disabled={uploading}>{uploading ? "Uploading..." : "Share"}</Button>
                    <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Resource list */}
            {resourcesLoading ? (
              <div className="flex justify-center py-8"><LoadingSpinner /></div>
            ) : resources.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No resources shared yet.</p>
            ) : (
              resources.map((r) => (
                <Card key={r.id} className="border border-border/60">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold">{r.title}</p>
                      <div className="flex gap-1.5">
                        {r.subject && <Badge variant="secondary" className="text-[10px]">{r.subject}</Badge>}
                        {r.grade && <Badge variant="secondary" className="text-[10px]">{r.grade}</Badge>}
                      </div>
                    </div>
                    {r.description && <p className="text-xs text-muted-foreground mb-2">{r.description}</p>}
                    <p className="text-[10px] text-muted-foreground mb-2">Uploaded by {r.uploader_name}</p>

                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} onClick={() => rateResource(r, n)}>
                            <Star className={cn("h-3.5 w-3.5", (r.my_rating ?? Math.round(r.avg_rating)) >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                          </button>
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">{r.avg_rating.toFixed(1)} ({r.rating_count})</span>
                      <span className="text-xs text-muted-foreground">· {r.download_count} downloads</span>
                    </div>

                    <Button size="sm" variant="outline" onClick={() => handleDownload(r)}>
                      <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
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
