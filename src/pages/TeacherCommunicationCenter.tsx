/**
 * TeacherCommunicationCenter.tsx — APAS-060
 * Centralized messaging hub: Teacher <-> Parents / Students / Administrators.
 * Supports individual chat, class broadcasts, appreciation/behaviour message
 * types, appointment booking shortcut, file attachments, and read-receipt tracking.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Search, Send, Paperclip, Users, User, ShieldCheck,
  MessageSquare, Check, CheckCheck, Calendar as CalendarIcon,
  Sparkles, Smile, X, FileText, Image as ImageIcon, ChevronLeft, Trash2,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { TeacherCommunitiesContent } from "@/pages/TeacherCommunities";

// ─── Types ────────────────────────────────────────────────────────────────────

type RecipientRole = "parent" | "student" | "admin";
type MessageType = "general" | "appreciation" | "behaviour" | "meeting_request";

interface Contact {
  id: string; // profile id (recipient_id) OR class_id for group
  kind: "individual" | "class_group";
  role: RecipientRole;
  name: string;
  subtitle?: string; // e.g. class/section, or "Parents" / "Students" for group
  classId?: string;
}

interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  recipient_role: RecipientRole;
  message: string;
  message_type: MessageType;
  attachment_url: string | null;
  attachment_name: string | null;
  meeting_date: string | null;
  meeting_time: string | null;
  meeting_status: string | null;
  batch_id: string | null;
  broadcast_label: string | null;
  is_read: boolean;
  created_at: string;
}

const QUICK_EMOJIS = [
  "😀", "😊", "😂", "🙂", "😉", "😍", "🤗", "😢", "😮", "🤔",
  "👍", "👏", "🙌", "💪", "🙏", "👋", "✅", "❌", "⭐", "🎉",
  "❤️", "💯", "🔥", "📚", "✏️", "📝", "📌", "⏰", "📅", "🏆",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dayLabel = (dateStr: string) => {
  const d = new Date(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "d MMM yyyy");
};

const roleBadgeColor: Record<RecipientRole, string> = {
  parent: "bg-blue-100 text-blue-700 border-blue-200",
  student: "bg-green-100 text-green-700 border-green-200",
  admin: "bg-purple-100 text-purple-700 border-purple-200",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TeacherCommunicationCenter() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loadingContacts, setLoadingContacts] = useState(true);
  const [contactTab, setContactTab] = useState<RecipientRole>("parent");
  const [search, setSearch] = useState("");

  const [parentContacts, setParentContacts] = useState<Contact[]>([]);
  const [studentContacts, setStudentContacts] = useState<Contact[]>([]);
  const [adminContacts, setAdminContacts] = useState<Contact[]>([]);
  const [classGroups, setClassGroups] = useState<{ classId: string; className: string; section: string }[]>([]);

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showMobileChat, setShowMobileChat] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [view, setView] = useState<"messages" | "communities">("messages");

  // Last message per contact, for history/preview
  const [lastMessages, setLastMessages] = useState<Map<string, Message>>(new Map());

  // ── Fetch contacts (parents, students, admins in teacher's classes/school) ──
  const fetchContacts = useCallback(async () => {
    if (!user?.id || !profile?.school_id) return;
    setLoadingContacts(true);
    try {
      // Teacher's assigned classes
      const { data: assignedClasses } = await supabase
        .from("class_teachers")
        .select("class_id")
        .eq("teacher_id", user.id);
      const classIds = [...new Set((assignedClasses || []).map((c: any) => c.class_id))];

      if (classIds.length === 0) {
        setParentContacts([]);
        setStudentContacts([]);
        setClassGroups([]);
      } else {
        const { data: classRows } = await supabase
          .from("classes")
          .select("id, name, section")
          .in("id", classIds);

        setClassGroups(
          (classRows || []).map((c: any) => ({ classId: c.id, className: c.name, section: c.section }))
        );

        // Students in those classes
        const { data: classStudentLinks } = await supabase
          .from("class_students")
          .select("class_id, student_id")
          .in("class_id", classIds);

        const studentIds = [...new Set((classStudentLinks || []).map((cs: any) => cs.student_id))];

        if (studentIds.length > 0) {
  const { data: students } = await supabase
    .from("students")
    .select("id, full_name, profile_id, class, section")
    .in("id", studentIds);

  const classMap = new Map((classRows || []).map((c: any) => [c.id, c]));
  const studentToClass = new Map(
    (classStudentLinks || []).map((cs: any) => [cs.student_id, cs.class_id])
  );

  const studentContactsList: Contact[] = (students || [])
    .filter((s: any) => s.profile_id)
    .map((s: any) => {
      const cId = studentToClass.get(s.id);
      const cls = classMap.get(cId);
      return {
        id: s.profile_id,
        kind: "individual" as const,
        role: "student" as const,
        name: s.full_name || "Unnamed Student",
        subtitle: cls ? `${cls.name} - ${cls.section}` : "",
        classId: cId,
      };
    });
  setStudentContacts(studentContactsList);

  // Parents linked to those students — parent_students.student_id is a
  // PROFILE id (matches students.profile_id), NOT students.id.
  const profileIds = (students || []).map((s: any) => s.profile_id).filter(Boolean);
  const { data: parentLinks } = profileIds.length > 0
    ? await supabase.from("parent_students").select("parent_id, student_id").in("student_id", profileIds)
    : { data: [] as any[] };

  const parentIds = [...new Set((parentLinks || []).map((p: any) => p.parent_id))];
  if (parentIds.length > 0) {
    const { data: parentProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", parentIds);

    const studentNameMap = new Map((students || []).map((s: any) => [s.profile_id, s]));
    const parentToStudents = new Map<string, { name: string; class: string; section: string }[]>();
    for (const link of (parentLinks || []) as any[]) {
      const list = parentToStudents.get(link.parent_id) || [];
      const stu = studentNameMap.get(link.student_id);
      if (stu) list.push({ name: stu.full_name, class: stu.class, section: stu.section });
      parentToStudents.set(link.parent_id, list);
    }

            const parentContactsList: Contact[] = (parentProfiles || []).map((p: any) => {
              const kids = parentToStudents.get(p.id) || [];
              const subtitle = kids
                .map(k => `${k.name}${k.class ? ` (${k.class}${k.section ? ` - ${k.section}` : ""})` : ""}`)
                .join(", ");
              return {
                id: p.id,
                kind: "individual" as const,
                role: "parent" as const,
                name: p.full_name || "Unnamed Parent",
                subtitle: `Parent of ${subtitle}`,
              };
            });
            setParentContacts(parentContactsList);
          } else {
            setParentContacts([]);
          }
        } else {
          setStudentContacts([]);
          setParentContacts([]);
        }
      }

      // Administrators in the same school
      const { data: admins } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("school_id", profile.school_id)
        .in("role", ["admin", "principal", "school_admin", "hod"]);

      setAdminContacts(
        (admins || []).map((a: any) => ({
          id: a.id,
          kind: "individual" as const,
          role: "admin" as const,
          name: a.full_name || "Unnamed",
          subtitle: a.role === "school_admin" ? "School Admin" : a.role.charAt(0).toUpperCase() + a.role.slice(1),
        }))
      );

      // Fetch last message per contact for previews
      const { data: allMsgs } = await supabase
        .from("teacher_messages" as any)
        .select("*")
        .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .order("created_at", { ascending: false });

      const lastMap = new Map<string, Message>();
      for (const m of (allMsgs || []) as Message[]) {
        const otherId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
        if (!lastMap.has(otherId)) lastMap.set(otherId, m);
      }
      setLastMessages(lastMap);
    } catch (e: any) {
      toast({ title: "Error loading contacts", description: e.message, variant: "destructive" });
    } finally {
      setLoadingContacts(false);
    }
  }, [user?.id, profile?.school_id, toast]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  // ── Fetch thread for selected contact ───────────────────────────────────────
  const fetchThread = useCallback(async (contact: Contact) => {
    if (!user?.id) return;
    setThreadLoading(true);
    try {
      if (contact.kind === "individual") {
        const { data } = await supabase
          .from("teacher_messages" as any)
          .select("*")
          .or(
            `and(sender_id.eq.${user.id},recipient_id.eq.${contact.id}),and(sender_id.eq.${contact.id},recipient_id.eq.${user.id})`
          )
          .order("created_at", { ascending: true });
        setMessages((data || []) as unknown as Message[]);

        // Mark received messages as read
        const unreadIds = ((data || []) as any[])
          .filter(m => m.recipient_id === user.id && !m.is_read)
          .map(m => m.id);
        if (unreadIds.length > 0) {
          await supabase.from("teacher_messages" as any).update({ is_read: true }).in("id", unreadIds);
        }
      } else {
        // Class group: show all broadcast messages sent to this class
        const { data } = await supabase
          .from("teacher_messages" as any)
          .select("*")
          .eq("sender_id", user.id)
          .not("batch_id", "is", null)
          .order("created_at", { ascending: true });
        // Filter client-side by broadcast_label matching this class
        const filtered = ((data || []) as any[]).filter(
          m => m.broadcast_label?.includes(contact.name)
        );
        setMessages(filtered as Message[]);
      }
    } catch (e: any) {
      toast({ title: "Error loading messages", description: e.message, variant: "destructive" });
    } finally {
      setThreadLoading(false);
    }
  }, [user?.id, toast]);

  useEffect(() => {
    if (selectedContact) fetchThread(selectedContact);
  }, [selectedContact, fetchThread]);

  const openContact = (contact: Contact) => {
    setSelectedContact(contact);
    setShowMobileChat(true);
    setMessageText("");
    setAttachedFile(null);
  };

  // ── Send message ─────────────────────────────────────────────────────────────
  const uploadAttachment = async (file: File): Promise<{ url: string; name: string } | null> => {
    setUploadingFile(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user!.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("message-attachments").upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("message-attachments").getPublicUrl(path);
      return { url: urlData.publicUrl, name: file.name };
    } catch (e: any) {
      toast({ title: "Attachment upload failed", description: e.message, variant: "destructive" });
      return null;
    } finally {
      setUploadingFile(false);
    }
  };

  // ── Omnichannel fan-out ───────────────────────────────────────────────────
  // Fire-and-forget: never blocks the chat UI, and a failure here must never
  // surface as a "message failed to send" error — the in-app row already
  // landed, this is just the push/email echo of it.
  const dispatchOmnichannel = (params: {
    sourceId: string;
    recipientId: string;
    title: string;
    body: string;
  }) => {
    supabase.functions
      .invoke("dispatch-message", {
        body: {
          source_table: "teacher_messages",
          source_id: params.sourceId,
          recipient_id: params.recipientId,
          title: params.title,
          body: params.body,
        },
      })
      .catch((e) => console.error("dispatch-message failed", e));
  };

  const handleSend = async (
    overrideText?: string,
    messageType: MessageType = "general",
    meetingInfo?: { date: string; time: string }
  ) => {
    const text = overrideText ?? messageText;
    if (!text.trim() && !attachedFile) {
      toast({ title: "Write a message or attach a file", variant: "destructive" });
      return;
    }
    if (!selectedContact || !user?.id || !profile?.school_id) return;

    setSending(true);
    try {
      let attachment: { url: string; name: string } | null = null;
      if (attachedFile) {
        attachment = await uploadAttachment(attachedFile);
      }

      const senderName = profile.full_name || "Your teacher";
      const notifyBody = text.trim() || (attachment ? `📎 ${attachment.name}` : "New message");

      if (selectedContact.kind === "individual") {
        const messageId = crypto.randomUUID();
        const { error } = await supabase.from("teacher_messages" as any).insert({
          id: messageId,
          school_id: profile.school_id,
          sender_id: user.id,
          recipient_id: selectedContact.id,
          recipient_role: selectedContact.role,
          message: text.trim() || "📎 Attachment",
          message_type: messageType,
          attachment_url: attachment?.url || null,
          attachment_name: attachment?.name || null,
          meeting_date: meetingInfo?.date || null,
          meeting_time: meetingInfo?.time || null,
          meeting_status: messageType === "meeting_request" ? "pending" : null,
        });
        if (error) throw error;

        dispatchOmnichannel({
          sourceId: messageId,
          recipientId: selectedContact.id,
          title: `New message from ${senderName}`,
          body: notifyBody,
        });
      } else {
        // Class broadcast: expand into one row per recipient
        const batchId = crypto.randomUUID();

        // Build recipient id list precisely
        let recipientIds: string[] = [];
        if (selectedContact.role === "student") {
          recipientIds = studentContacts
            .filter(s => s.classId === selectedContact.classId)
            .map(s => s.id);
        } else {
          // parents: find students in this class, then their linked parents
        const { data: classStudentRows } = await supabase
            .from("students")
            .select("profile_id")
            .eq("class", selectedContact.name.split(" - ")[0])
            .eq("section", selectedContact.name.split(" - ")[1] || "");
          const stuProfileIds = (classStudentRows || []).map((s: any) => s.profile_id).filter(Boolean);
          const { data: pLinks } = stuProfileIds.length > 0
            ? await supabase.from("parent_students").select("parent_id").in("student_id", stuProfileIds)
            : { data: [] as any[] };
          recipientIds = [...new Set((pLinks || []).map((p: any) => p.parent_id))];
        }

        if (recipientIds.length === 0) {
          toast({ title: "No recipients found in this class", variant: "destructive" });
          setSending(false);
          return;
        }

        const rows = recipientIds.map(rid => ({
          id: crypto.randomUUID(),
          school_id: profile.school_id,
          sender_id: user.id,
          recipient_id: rid,
          recipient_role: selectedContact.role,
          message: text.trim() || "📎 Attachment",
          message_type: messageType,
          attachment_url: attachment?.url || null,
          attachment_name: attachment?.name || null,
          batch_id: batchId,
          broadcast_label: selectedContact.name,
        }));

        const { error } = await supabase.from("teacher_messages" as any).insert(rows);
        if (error) throw error;

        const broadcastTitle = `${senderName} sent a message to ${selectedContact.name}`;
        rows.forEach(row => {
          dispatchOmnichannel({
            sourceId: row.id,
            recipientId: row.recipient_id,
            title: broadcastTitle,
            body: notifyBody,
          });
        });

        toast({ title: `Sent to ${recipientIds.length} ${selectedContact.role}(s)` });
      }

      setMessageText("");
      setAttachedFile(null);
      setShowEmojiPicker(false);
      fetchThread(selectedContact);
      fetchContacts();
    } catch (e: any) {
      toast({ title: "Error sending message", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  // ── Navigate to Appointment Booking, carrying selected parent/student context ──
  const goToAppointments = () => {
    if (!selectedContact) {
      navigate("/teacher/appointments");
      return;
    }
    navigate("/teacher/appointments", {
      state: {
        parentId: selectedContact.id,
        parentName: selectedContact.name,
        context: selectedContact.subtitle,
      },
    });
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!window.confirm("Delete this message? This cannot be undone.")) return;
    try {
      const { error } = await supabase.from("teacher_messages" as any).delete().eq("id", messageId);
      if (error) throw error;
      setMessages(prev => prev.filter(m => m.id !== messageId));
      fetchContacts();
    } catch (e: any) {
      toast({ title: "Couldn't delete message", description: e.message, variant: "destructive" });
    }
  };

  // ── Filtered contact list based on active tab + search ──────────────────────
  const currentContacts = useMemo(() => {
    let list: Contact[] = [];
    if (contactTab === "parent") list = parentContacts;
    else if (contactTab === "student") list = studentContacts;
    else list = adminContacts;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.subtitle?.toLowerCase().includes(q));
    }
    return list;
  }, [contactTab, parentContacts, studentContacts, adminContacts, search]);

  const groupContactsForTab = useMemo(() => {
    if (contactTab === "admin") return [];
    return classGroups.map(cg => ({
      id: cg.classId,
      kind: "class_group" as const,
      role: contactTab,
      name: `${cg.className} - ${cg.section}`,
      subtitle: contactTab === "parent" ? "All Parents" : "All Students",
      classId: cg.classId,
    }));
  }, [classGroups, contactTab]);

  return (
    <AppLayout>
      <div className="h-[calc(100vh-100px)] flex flex-col">
        <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold text-foreground">Communication Center</h1>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={view === "messages" ? "default" : "outline"}
              onClick={() => setView("messages")}
            >
              Messages
            </Button>
            <Button
              size="sm"
              variant={view === "communities" ? "default" : "outline"}
              onClick={() => setView("communities")}
            >
              Teacher Communities
            </Button>
          </div>
        </div>

        {view === "communities" ? (
          <TeacherCommunitiesContent />
        ) : (
        <Card className="flex-1 overflow-hidden border border-border/60 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] h-full min-h-0">

            {/* ── Contact List Panel ── */}
            <div className={`border-r border-border/60 flex flex-col ${showMobileChat ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 border-b border-border/60">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search student/parent"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8 h-9 text-sm"
                  />
                </div>
              </div>

              <Tabs value={contactTab} onValueChange={(v: any) => setContactTab(v)} className="px-2 pt-2">
                <TabsList className="grid grid-cols-3 w-full h-9">
                  <TabsTrigger value="parent" className="text-xs gap-1">
                    <Users className="h-3.5 w-3.5" /> Parents
                  </TabsTrigger>
                  <TabsTrigger value="student" className="text-xs gap-1">
                    <User className="h-3.5 w-3.5" /> Students
                  </TabsTrigger>
                  <TabsTrigger value="admin" className="text-xs gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" /> Admin
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {loadingContacts ? (
                  <div className="flex justify-center py-8"><LoadingSpinner /></div>
                ) : (
                  <>
                    {/* Class groups (parents/students only) */}
                    {groupContactsForTab.map(g => {
                      const isSelected = selectedContact?.id === g.id && selectedContact?.kind === "class_group";
                      return (
                        <button
                          key={`group-${g.id}`}
                          onClick={() => openContact(g)}
                          className={`w-full text-left p-2.5 rounded-lg flex items-center gap-2.5 transition-colors ${
                            isSelected ? "bg-blue-50 border border-blue-200" : "hover:bg-muted/50"
                          }`}
                        >
                          <div className="h-9 w-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                            <Users className="h-4 w-4 text-indigo-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold truncate">{g.name}</p>
                            <p className="text-xs text-muted-foreground">{g.subtitle}</p>
                          </div>
                        </button>
                      );
                    })}

                    {groupContactsForTab.length > 0 && currentContacts.length > 0 && (
                      <div className="h-px bg-border my-2" />
                    )}

                    {/* Individual contacts */}
                    {currentContacts.length === 0 && groupContactsForTab.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        No contacts found.
                      </p>
                    ) : (
                      currentContacts.map(c => {
                        const isSelected = selectedContact?.id === c.id && selectedContact?.kind === "individual";
                        const last = lastMessages.get(c.id);
                        return (
                          <button
                            key={c.id}
                            onClick={() => openContact(c)}
                            className={`w-full text-left p-2.5 rounded-lg flex items-center gap-2.5 transition-colors ${
                              isSelected ? "bg-blue-50 border border-blue-200" : "hover:bg-muted/50"
                            }`}
                          >
                            <div className="h-9 w-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-xs font-bold text-blue-700">
                              {c.name[0]}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold truncate">{c.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {last ? last.message : c.subtitle}
                              </p>
                            </div>
                            {last && !last.is_read && last.recipient_id === user?.id && (
                              <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ── Chat Panel ── */}
            <div className={`min-h-0 flex flex-col ${showMobileChat ? "flex" : "hidden md:flex"}`}>
              {!selectedContact ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <MessageSquare className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Select a contact to start messaging
                  </p>
                </div>
              ) : (
                <>
                  {/* Chat header */}
                  <div className="p-3 border-b border-border/60 flex items-center gap-2.5">
                    <button
                      className="md:hidden p-1"
                      onClick={() => setShowMobileChat(false)}
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                      selectedContact.kind === "class_group" ? "bg-indigo-100 text-indigo-600" : "bg-blue-100 text-blue-700"
                    }`}>
                      {selectedContact.kind === "class_group" ? <Users className="h-4 w-4" /> : selectedContact.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{selectedContact.name}</p>
                      <Badge className={`text-[10px] border ${roleBadgeColor[selectedContact.role]} capitalize`}>
                        {selectedContact.subtitle || selectedContact.role}
                      </Badge>
                    </div>
                    {selectedContact.role === "parent" && selectedContact.kind === "individual" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs"
                        onClick={goToAppointments}
                      >
                        <CalendarIcon className="h-3.5 w-3.5" />
                        Appointments
                      </Button>
                    )}
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
                    {threadLoading ? (
                      <div className="flex justify-center py-8"><LoadingSpinner /></div>
                    ) : messages.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        No messages yet. Start the conversation below.
                      </p>
                    ) : (
                      messages.map((m, i) => {
                        const isMine = m.sender_id === user?.id;
                        const showDateSep = i === 0 || dayLabel(messages[i - 1].created_at) !== dayLabel(m.created_at);
                        return (
                          <div key={m.id}>
                            {showDateSep && (
                              <div className="flex justify-center my-3">
                                <span className="text-[10px] bg-muted text-muted-foreground px-2.5 py-1 rounded-full">
                                  {dayLabel(m.created_at)}
                                </span>
                              </div>
                            )}
                            <div className={`flex ${isMine ? "justify-end" : "justify-start"} group`}>
                              {isMine && (
                                <button
                                  onClick={() => handleDeleteMessage(m.id)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity self-center mr-1.5 p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600"
                                  title="Delete message"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <div
                                className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 ${
                                  isMine
                                    ? "bg-blue-600 text-white rounded-br-sm"
                                    : "bg-white border border-border/60 rounded-bl-sm"
                                }`}
                              >
                                {m.message_type === "appreciation" && (
                                  <div className="flex items-center gap-1 mb-1 opacity-90">
                                    <Sparkles className="h-3 w-3" />
                                    <span className="text-[10px] font-semibold uppercase tracking-wide">Appreciation</span>
                                  </div>
                                )}
                                {m.message_type === "behaviour" && (
                                  <div className="flex items-center gap-1 mb-1 opacity-90">
                                    <span className="text-[10px] font-semibold uppercase tracking-wide">Behaviour Update</span>
                                  </div>
                                )}
                                {m.message_type === "meeting_request" && (
                                  <div className="flex items-center gap-1 mb-1 opacity-90">
                                    <CalendarIcon className="h-3 w-3" />
                                    <span className="text-[10px] font-semibold uppercase tracking-wide">Meeting Request</span>
                                  </div>
                                )}
                                <p className="text-sm whitespace-pre-line">{m.message}</p>
                                {m.attachment_url && (
                                  <a
                                    href={m.attachment_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`flex items-center gap-1.5 mt-1.5 text-xs underline ${isMine ? "text-blue-100" : "text-blue-600"}`}
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    {m.attachment_name || "Attachment"}
                                  </a>
                                )}
                                <div className={`flex items-center gap-1 mt-1 ${isMine ? "justify-end" : "justify-start"}`}>
                                  <span className={`text-[10px] ${isMine ? "text-blue-100" : "text-muted-foreground"}`}>
                                    {format(new Date(m.created_at), "h:mm a")}
                                  </span>
                                  {isMine && (
                                    m.is_read
                                      ? <CheckCheck className="h-3 w-3 text-blue-100" />
                                      : <Check className="h-3 w-3 text-blue-100" />
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Emoji picker */}
                  {showEmojiPicker && (
                    <div className="px-3 pb-2">
                      <div className="flex flex-wrap gap-1.5 border border-border/60 rounded-lg p-2.5 bg-background max-w-xs">
                        {QUICK_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setMessageText((prev) => prev + emoji)}
                            className="text-lg hover:bg-muted rounded p-1 transition-colors"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Attached file preview */}
                  {attachedFile && (
                    <div className="px-3 pb-2">
                      <div className="inline-flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 text-xs">
                        <FileText className="h-3.5 w-3.5" />
                        {attachedFile.name}
                        <button onClick={() => setAttachedFile(null)}>
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Compose bar */}
                  <div className="p-3 border-t border-border/60 flex items-end gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) setAttachedFile(f);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => fileInputRef.current?.click()}
                      title="Attach file"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setShowEmojiPicker(v => !v)}
                      title="Insert emoji"
                    >
                      <Smile className="h-4 w-4" />
                    </Button>
                    <Textarea
                      placeholder="Type a message..."
                      value={messageText}
                      onChange={e => setMessageText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      rows={1}
                      className="resize-none min-h-[40px] max-h-32 text-sm"
                    />
                    <Button
                      onClick={() => handleSend()}
                      disabled={sending || uploadingFile}
                      className="shrink-0 gap-1.5 bg-blue-600 hover:bg-blue-700"
                    >
                      {sending || uploadingFile ? <LoadingSpinner size="sm" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>
        )}
      </div>
    </AppLayout>
  );
}
