import { useState } from "react";
import { transcodeToH264 } from "@/lib/videoTranscode";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Store, Upload, Play, Download, Trash2, Video as VideoIcon, GraduationCap, BookOpen, Users, ChevronDown, ChevronUp, CheckCircle2, Pencil, FileText, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppLayout } from "@/components/layout/AppLayout";
import { toast } from "sonner";
import {
  getSchoolVideos,
  getMyClassVideos,
  createVideoListing,
  deleteVideoListing,
  getListingFiles,
  getListingFileSignedUrl,
  getClassLabel,
  CLASS_OPTIONS,
  SUBJECT_OPTIONS,
  type MarketplaceListing,
  getSchoolCourses,
  getAvailableCourses,
  createCourseListing,
  updateCourseListing,
  deleteCourseListing,
  enrollInCourse,
  unenrollFromCourse,
  getMyEnrolledCourseIds,
  getCourseRoster,
  getCourseMaterials,
  addCourseMaterial,
  deleteCourseMaterial,
  getCourseMaterialSignedUrl,
  type CourseMaterial,
  getSyllabusFileSignedUrl,
} from "@/lib/marketplace";

function getYouTubeEmbed(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

function VideoPlayer({ listing }: { listing: MarketplaceListing }) {
  const [expanded, setExpanded] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadFile = async () => {
    setLoading(true);
    try {
      const files = await getListingFiles(listing.id);
      if (files.length > 0) {
        const url = await getListingFileSignedUrl(files[0].storage_path);
        setSignedUrl(url);
      } else {
        toast.error("No video file found for this listing");
      }
    } catch {
      toast.error("Failed to load video");
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = async () => {
    if (!expanded) {
      if (!listing.video_url && !signedUrl) await loadFile();
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  };

  const youTubeEmbed = listing.video_url ? getYouTubeEmbed(listing.video_url) : null;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 rounded-full" onClick={handlePlay} disabled={loading}>
          <Play className="h-3.5 w-3.5 mr-1" />
          {loading ? "Loading..." : expanded ? "Hide" : "Play"}
        </Button>
        {!listing.video_url && (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full"
            onClick={async () => {
              const files = await getListingFiles(listing.id);
              if (files.length > 0) {
                const url = await getListingFileSignedUrl(files[0].storage_path);
                window.open(url, "_blank");
              } else {
                toast.error("No file to download");
              }
            }}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {expanded && (
        youTubeEmbed ? (
          <iframe
            src={youTubeEmbed}
            className="w-full aspect-video rounded-xl"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : listing.video_url ? (
          <video src={listing.video_url} controls className="w-full rounded-xl" />
        ) : signedUrl ? (
          <video src={signedUrl} controls className="w-full rounded-xl" />
        ) : null
      )}
    </div>
  );
}

function HeroBanner({ title, eyebrow, icon: Icon, pills }: { title: string; eyebrow: string; icon: any; pills: string[] }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 via-blue-500 to-teal-400 p-8">
      <div className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute right-28 bottom-[-2rem] h-28 w-28 rounded-full bg-white/10 blur-xl" />
      <div className="relative flex items-center gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm ring-2 ring-white/30">
          <Icon className="h-7 w-7 text-white" />
        </div>
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/80">
            <GraduationCap className="h-3.5 w-3.5" /> {eyebrow}
          </p>
          <h1 className="text-2xl md:text-3xl font-bold text-white">{title}</h1>
          <div className="flex flex-wrap gap-2 pt-1">
            {pills.map((p) => (
              <span key={p} className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CourseRoster({ listingId }: { listingId: string }) {
  const { data: roster, isLoading } = useQuery({
    queryKey: ["course-roster", listingId],
    queryFn: () => getCourseRoster(listingId),
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!roster || roster.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No students enrolled yet.</p>;
  }

  return (
    <div className="space-y-1.5 py-2">
      {roster.map((r) => (
        <div key={r.buyer_user_id} className="flex items-center justify-between text-xs bg-muted/40 rounded-lg px-3 py-1.5">
          <span className="font-medium">{r.student_name ?? "Unknown student"}</span>
          <span className="text-muted-foreground">
            {r.student_class ? `Class ${r.student_class}` : ""} {r.roll_number ? `· Roll ${r.roll_number}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function SyllabusViewer({ listing }: { listing: MarketplaceListing }) {
  const [loading, setLoading] = useState(false);
  if (!listing.syllabus_file_path) return null;

  const handleView = async () => {
    setLoading(true);
    try {
      const url = await getSyllabusFileSignedUrl(listing.syllabus_file_path!);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Failed to load syllabus file");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button size="sm" variant="outline" className="w-full rounded-full" onClick={handleView} disabled={loading}>
      <Eye className="h-3.5 w-3.5 mr-1" />
      {loading ? "Loading..." : "View Syllabus"}
    </Button>
  );
}

function CourseMaterialsPanel({ listingId, canManage }: { listingId: string; canManage: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [matTitle, setMatTitle] = useState("");
  const [matType, setMatType] = useState<"video" | "document">("video");
  const [matVideoUrl, setMatVideoUrl] = useState("");
  const [matFile, setMatFile] = useState<File | null>(null);

  const { data: materials, isLoading } = useQuery({
    queryKey: ["course-materials", listingId],
    queryFn: () => getCourseMaterials(listingId),
  });

  const resetMatForm = () => {
    setMatTitle("");
    setMatVideoUrl("");
    setMatFile(null);
    setShowForm(false);
  };

  const addMutation = useMutation({
    mutationFn: () =>
      addCourseMaterial({
        listingId,
        uploadedBy: user!.id,
        title: matTitle,
        materialType: matType,
        videoUrl: matType === "video" ? matVideoUrl.trim() || null : null,
        file: matFile,
      }),
    onSuccess: () => {
      toast.success("Material added");
      resetMatForm();
      queryClient.invalidateQueries({ queryKey: ["course-materials", listingId] });
    },
    onError: () => toast.error("Failed to add material"),
  });

  const deleteMutation = useMutation({
    mutationFn: (m: CourseMaterial) => deleteCourseMaterial(m.id, m.storage_path),
    onSuccess: () => {
      toast.success("Material removed");
      queryClient.invalidateQueries({ queryKey: ["course-materials", listingId] });
    },
    onError: () => toast.error("Failed to remove material"),
  });

  const openMaterial = async (m: CourseMaterial) => {
    if (m.video_url) {
      window.open(m.video_url, "_blank");
      return;
    }
    if (m.storage_path) {
      try {
        const url = await getCourseMaterialSignedUrl(m.storage_path);
        window.open(url, "_blank");
      } catch {
        toast.error("Failed to open material");
      }
    }
  };

  const canSubmitMaterial =
    matTitle.trim().length > 0 &&
    (matType === "video" ? matVideoUrl.trim().length > 0 || !!matFile : !!matFile) &&
    !addMutation.isPending;

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Materials</span>
        {canManage && (
          <Button size="sm" variant="ghost" className="h-6 text-xs rounded-full" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ Add"}
          </Button>
        )}
      </div>

      {canManage && showForm && (
        <div className="space-y-2 bg-muted/30 rounded-lg p-3">
          <Input
            placeholder="Material title"
            value={matTitle}
            onChange={(e) => setMatTitle(e.target.value)}
            className="h-8 text-xs"
          />
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={matType === "video" ? "default" : "outline"}
              className="h-7 text-xs flex-1 rounded-full"
              onClick={() => setMatType("video")}
            >
              Video
            </Button>
            <Button
              size="sm"
              variant={matType === "document" ? "default" : "outline"}
              className="h-7 text-xs flex-1 rounded-full"
              onClick={() => setMatType("document")}
            >
              Document
            </Button>
          </div>
          {matType === "video" ? (
            <>
              <Input
                placeholder="Video link (YouTube, Drive, etc.)"
                value={matVideoUrl}
                onChange={(e) => setMatVideoUrl(e.target.value)}
                className="h-8 text-xs"
              />
              <div className="text-[10px] text-muted-foreground text-center">— or upload a file —</div>
              <Input type="file" accept="video/*" onChange={(e) => setMatFile(e.target.files?.[0] ?? null)} className="text-xs" />
            </>
          ) : (
            <Input
              type="file"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.txt"
              onChange={(e) => setMatFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
          )}
          <Button
            size="sm"
            className="w-full h-7 text-xs bg-blue-600 hover:bg-blue-700 rounded-full"
            onClick={() => addMutation.mutate()}
            disabled={!canSubmitMaterial}
          >
            {addMutation.isPending ? "Adding..." : "Add Material"}
          </Button>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : !materials || materials.length === 0 ? (
        <p className="text-xs text-muted-foreground">No materials added yet.</p>
      ) : (
        <div className="space-y-1.5">
          {materials.map((m) => (
            <div key={m.id} className="flex items-center justify-between text-xs bg-muted/40 rounded-lg px-3 py-1.5">
              <button className="flex items-center gap-1.5 min-w-0 hover:underline text-left" onClick={() => openMaterial(m)}>
                {m.material_type === "video" ? (
                  <Play className="h-3 w-3 shrink-0 text-blue-600" />
                ) : (
                  <FileText className="h-3 w-3 shrink-0 text-blue-600" />
                )}
                <span className="truncate">{m.title}</span>
              </button>
              {canManage && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 text-red-500 hover:text-red-700 shrink-0"
                  onClick={() => deleteMutation.mutate(m)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminCourses() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [materialsOpenId, setMaterialsOpenId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [syllabusFile, setSyllabusFile] = useState<File | null>(null);

  const { data: courses, isLoading } = useQuery({
    queryKey: ["marketplace-school-courses", profile?.school_id],
    queryFn: () => getSchoolCourses(profile!.school_id!),
    enabled: !!profile?.school_id,
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setClassLabel("");
    setSyllabus("");
    setSyllabusFile(null);
    setShowForm(false);
    setEditingId(null);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createCourseListing({
        publisherId: user!.id,
        publisherSchoolId: profile!.school_id!,
        title,
        description,
        classLabel: classLabel || null,
        syllabus: syllabus || null,
        syllabusFile,
      }),
    onSuccess: () => {
      toast.success("Course created");
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["marketplace-school-courses"] });
    },
    onError: () => toast.error("Failed to create course"),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateCourseListing(editingId!, {
        title,
        description,
        classLabel: classLabel || null,
        syllabus: syllabus || null,
        syllabusFile,
      }),
    onSuccess: () => {
      toast.success("Course updated");
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["marketplace-school-courses"] });
    },
    onError: () => toast.error("Failed to update course"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCourseListing(id),
    onSuccess: () => {
      toast.success("Course deleted");
      queryClient.invalidateQueries({ queryKey: ["marketplace-school-courses"] });
    },
    onError: () => toast.error("Failed to delete course"),
  });

  const startEdit = (c: MarketplaceListing) => {
    setEditingId(c.id);
    setTitle(c.title);
    setDescription(c.description ?? "");
    setClassLabel(c.class_label ?? "");
    setSyllabus(c.syllabus ?? "");
    setSyllabusFile(null);
    setShowForm(false);
  };

  const handleDelete = (c: MarketplaceListing) => {
    if (window.confirm(`Delete "${c.title}"? This will also remove all student enrollments for this course.`)) {
      deleteMutation.mutate(c.id);
    }
  };

  const isEditing = editingId !== null;
  const formPending = createMutation.isPending || updateMutation.isPending;
  const canSubmit = title.trim().length > 0 && !formPending;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 rounded-full"
          onClick={() => {
            if (isEditing) {
              resetForm();
            } else {
              setShowForm((v) => !v);
            }
          }}
        >
          {showForm || isEditing ? "Cancel" : "+ New Course"}
        </Button>
      </div>

      {(showForm || isEditing) && (
        <Card className="max-w-xl border-2 border-blue-200 rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4" /> {isEditing ? "Edit Course" : "Create Course"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Spoken English Club" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Description</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Syllabus</label>
              <Textarea
                value={syllabus}
                onChange={(e) => setSyllabus(e.target.value)}
                rows={4}
                placeholder="Outline what this course covers, week by week or topic by topic..."
              />
              <div className="text-[10px] text-muted-foreground text-center pt-1">— or upload a syllabus file (PDF/doc) —</div>
              <Input
                type="file"
                accept=".pdf,.doc,.docx,.ppt,.pptx"
                onChange={(e) => setSyllabusFile(e.target.files?.[0] ?? null)}
              />
              {isEditing && editingId && courses?.find((c) => c.id === editingId)?.syllabus_file_path && !syllabusFile && (
                <p className="text-[10px] text-muted-foreground">A syllabus file is already attached. Uploading a new one will replace it.</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Class</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={classLabel}
                onChange={(e) => setClassLabel(e.target.value)}
              >
                <option value="">All Classes</option>
                {CLASS_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <Button
              onClick={() => (isEditing ? updateMutation.mutate() : createMutation.mutate())}
              disabled={!canSubmit}
              className="bg-blue-600 hover:bg-blue-700 rounded-full"
            >
              {formPending ? "Saving..." : isEditing ? "Save Changes" : "Create Course"}
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !courses || courses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No courses created yet.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {courses.map((c) => {
            const isExpanded = expandedId === c.id;
            const isMaterialsOpen = materialsOpenId === c.id;
            return (
              <Card key={c.id} className="border-2 border-blue-200 rounded-2xl bg-gradient-to-br from-blue-50/60 via-white to-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <BookOpen className="h-4 w-4 text-blue-600 shrink-0" />
                      <span className="line-clamp-1">{c.title}</span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-blue-600 hover:text-blue-800"
                        onClick={() => startEdit(c)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-red-500 hover:text-red-700"
                        onClick={() => handleDelete(c)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Badge variant="secondary" className="rounded-full w-fit">
                    {c.class_label ? getClassLabel(c.class_label) : "All Classes"}
                  </Badge>
                  {c.description && <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>}
                  <SyllabusViewer listing={c} />
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-full"
                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  >
                    <Users className="h-3.5 w-3.5 mr-1" />
                    Students
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                  </Button>
                  {isExpanded && <CourseRoster listingId={c.id} />}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-full"
                    onClick={() => setMaterialsOpenId(isMaterialsOpen ? null : c.id)}
                  >
                    <BookOpen className="h-3.5 w-3.5 mr-1" />
                    Materials
                    {isMaterialsOpen ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                  </Button>
                  {isMaterialsOpen && <CourseMaterialsPanel listingId={c.id} canManage />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StudentCourses() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: courses, isLoading } = useQuery({
    queryKey: ["marketplace-available-courses", profile?.id],
    queryFn: getAvailableCourses,
    enabled: !!profile?.id,
  });

  const { data: enrolledIds } = useQuery({
    queryKey: ["my-enrolled-course-ids", user?.id],
    queryFn: () => getMyEnrolledCourseIds(user!.id),
    enabled: !!user?.id,
  });

  const enrollMutation = useMutation({
    mutationFn: (listingId: string) => enrollInCourse(listingId, user!.id, profile?.school_id ?? null),
    onSuccess: () => {
      toast.success("Enrolled!");
      queryClient.invalidateQueries({ queryKey: ["my-enrolled-course-ids"] });
    },
    onError: () => toast.error("Failed to enroll"),
  });

  const dropMutation = useMutation({
    mutationFn: (listingId: string) => unenrollFromCourse(listingId, user!.id),
    onSuccess: (_data, listingId) => {
      toast.success("You've dropped the course");
      if (expandedId === listingId) setExpandedId(null);
      queryClient.invalidateQueries({ queryKey: ["my-enrolled-course-ids"] });
    },
    onError: () => toast.error("Failed to drop course"),
  });

  const handleDrop = (c: MarketplaceListing) => {
    if (window.confirm(`Drop "${c.title}"? You'll lose access to its materials until you re-enroll.`)) {
      dropMutation.mutate(c.id);
    }
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!courses || courses.length === 0) {
    return <p className="text-sm text-muted-foreground">No courses available yet.</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {courses.map((c) => {
        const isEnrolled = enrolledIds?.has(c.id);
        return (
          <Card key={c.id} className="border-2 border-blue-200 rounded-2xl bg-gradient-to-br from-blue-50/60 via-white to-white hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-blue-600 shrink-0" />
                <span className="line-clamp-1">{c.title}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {c.description && <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>}
              {c.syllabus && (
                <div className="text-xs bg-muted/30 rounded-lg p-2 space-y-1">
                  <p className="font-semibold text-muted-foreground">Syllabus</p>
                  <p className="whitespace-pre-wrap line-clamp-4">{c.syllabus}</p>
                </div>
              )}
              <SyllabusViewer listing={c} />
              {isEnrolled ? (
                <>
                  <Badge variant="secondary" className="rounded-full flex items-center gap-1 w-fit">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Enrolled
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-full"
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  >
                    {expandedId === c.id ? "Hide Materials" : "View Materials"}
                  </Button>
                  {expandedId === c.id && <CourseMaterialsPanel listingId={c.id} canManage={false} />}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-full text-red-500 hover:text-red-700 border-red-200 hover:bg-red-50"
                    onClick={() => handleDrop(c)}
                    disabled={dropMutation.isPending}
                  >
                    Drop Course
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  className="w-full bg-blue-600 hover:bg-blue-700 rounded-full"
                  onClick={() => enrollMutation.mutate(c.id)}
                  disabled={enrollMutation.isPending}
                >
                  Enroll
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AdminMarketplace() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("videos");
  const [filterClass, setFilterClass] = useState("");
  const [filterSubject, setFilterSubject] = useState("");

  const { data: videos, isLoading } = useQuery({
    queryKey: ["marketplace-school-videos", profile?.school_id],
    queryFn: () => getSchoolVideos(profile!.school_id!),
    enabled: !!profile?.school_id,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteVideoListing(id),
    onSuccess: () => {
      toast.success("Video removed");
      queryClient.invalidateQueries({ queryKey: ["marketplace-school-videos"] });
    },
    onError: () => toast.error("Failed to remove video"),
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [subject, setSubject] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [transcoding, setTranscoding] = useState(false);
  const [transcodeProgress, setTranscodeProgress] = useState(0);
  const createMutation = useMutation({
    mutationFn: async () => {
      let fileToUpload = file;
      if (file && file.type.startsWith("video/")) {
        setTranscoding(true);
        setTranscodeProgress(0);
        try {
          fileToUpload = await transcodeToH264(file, (ratio) => setTranscodeProgress(ratio));
        } finally {
          setTranscoding(false);
        }
      }
      return createVideoListing({
        publisherId: user!.id,
        publisherSchoolId: profile!.school_id!,
        title,
        description,
        classLabel,
        subject,
        videoUrl: videoUrl.trim() || null,
        file: fileToUpload,
      });
    },
    onSuccess: () => {
      toast.success("Video published");
      setTitle("");
      setDescription("");
      setClassLabel("");
      setSubject("");
      setVideoUrl("");
      setFile(null);
      setTranscodeProgress(0);
      queryClient.invalidateQueries({ queryKey: ["marketplace-school-videos"] });
      setTab("videos");
    },
    onError: (err) => {
      console.error("Publish video error:", err);
      toast.error("Failed to publish video");
    },
  });

  const filteredVideos = (videos ?? []).filter(
    (v) =>
      (!filterClass || v.class_label === filterClass) &&
      (!filterSubject || (v.subject ?? "").toLowerCase().includes(filterSubject.toLowerCase()))
  );

  const distinctClasses = new Set((videos ?? []).map((v) => v.class_label).filter(Boolean)).size;
  const canSubmit = title.trim() && classLabel && subject.trim() && (videoUrl.trim() || file) && !createMutation.isPending;

  return (
    <div className="space-y-5">
      <HeroBanner
        eyebrow="School Admin"
        title="Marketplace"
        icon={Store}
        pills={[]}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto gap-1 rounded-full bg-white border p-1 shadow-sm">
          <TabsTrigger value="videos" className="rounded-full px-5 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            All Videos
          </TabsTrigger>
          <TabsTrigger value="upload" className="rounded-full px-5 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            Upload Video
          </TabsTrigger>
          <TabsTrigger value="courses" className="rounded-full px-5 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            Courses
          </TabsTrigger>
        </TabsList>

        <TabsContent value="videos" className="space-y-3 mt-4">
          <div className="flex gap-2 flex-wrap">
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              className="flex h-9 rounded-full border border-input bg-white px-4 py-1 text-sm shadow-sm"
            >
              <option value="">All Classes</option>
              {CLASS_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <Input
              placeholder="Filter by subject..."
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              className="w-48 h-9 rounded-full"
            />
          </div>

          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : filteredVideos.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {filteredVideos.map((v) => (
                <Card key={v.id} className="border-2 border-blue-200 rounded-2xl bg-gradient-to-br from-blue-50/60 via-white to-white hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between gap-2">
                      <span className="line-clamp-1">{v.title}</span>
                      {v.publisher_id === user?.id && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-red-500 hover:text-red-700 shrink-0"
                          onClick={() => deleteMutation.mutate(v.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </CardTitle>
                    <div className="flex gap-1.5 flex-wrap">
                      <Badge variant="secondary" className="rounded-full">{getClassLabel(v.class_label)}</Badge>
                      <Badge variant="outline" className="rounded-full">{v.subject}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {v.description && <p className="text-xs text-muted-foreground line-clamp-2">{v.description}</p>}
                    <VideoPlayer listing={v} />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No videos uploaded yet.</p>
          )}
        </TabsContent>

        <TabsContent value="upload" className="mt-4">
          <Card className="max-w-xl border-2 border-blue-200 rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" /> Upload Learning Video
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fractions - Introduction" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Description</label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Class</label>
                  <select
                    value={classLabel}
                    onChange={(e) => setClassLabel(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="">Select class</option>
                    {CLASS_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Subject</label>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="">Select subject</option>
                    {SUBJECT_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Video Link (YouTube, Drive, etc.)</label>
                <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="text-xs text-muted-foreground text-center">— or —</div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Upload Video File</label>
                <Input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!canSubmit || createMutation.isPending || transcoding}
                className="bg-blue-600 hover:bg-blue-700 rounded-full"
              >
                {transcoding
                  ? `Preparing video... ${Math.round(transcodeProgress * 100)}%`
                  : createMutation.isPending
                  ? "Publishing..."
                  : "Publish Video"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="courses" className="mt-4">
          <AdminCourses />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StudentMarketplace() {
  const { profile } = useAuth();
  const [tab, setTab] = useState("videos");

  const { data: videos, isLoading } = useQuery({
    queryKey: ["marketplace-my-class-videos", profile?.id],
    queryFn: getMyClassVideos,
    enabled: !!profile?.id,
  });

  const bySubject = (videos ?? []).reduce<Record<string, MarketplaceListing[]>>((acc, v) => {
    const key = v.subject || "General";
    acc[key] = acc[key] || [];
    acc[key].push(v);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <HeroBanner
        eyebrow="Student"
        title="Marketplace"
        icon={Store}
        pills={[]}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto gap-1 rounded-full bg-white border p-1 shadow-sm">
          <TabsTrigger value="videos" className="rounded-full px-5 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            Videos
          </TabsTrigger>
          <TabsTrigger value="courses" className="rounded-full px-5 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            Courses
          </TabsTrigger>
        </TabsList>

        <TabsContent value="videos" className="mt-4">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !videos || videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No videos have been uploaded for your class yet.</p>
          ) : (
            <div className="space-y-6">
              {Object.entries(bySubject).map(([subject, list]) => (
                <div key={subject} className="space-y-3">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{subject}</h2>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {list.map((v) => (
                      <Card key={v.id} className="border-2 border-blue-200 rounded-2xl bg-gradient-to-br from-blue-50/60 via-white to-white hover:shadow-md transition-shadow">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <VideoIcon className="h-4 w-4 text-blue-600 shrink-0" />
                            <span className="line-clamp-1">{v.title}</span>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {v.description && <p className="text-xs text-muted-foreground line-clamp-2">{v.description}</p>}
                          <VideoPlayer listing={v} />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="courses" className="mt-4">
          <StudentCourses />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function Marketplace() {
  const { profile } = useAuth();
  const isStudent = profile?.role === "student";

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        {isStudent ? <StudentMarketplace /> : <AdminMarketplace />}
      </div>
    </AppLayout>
  );
}
