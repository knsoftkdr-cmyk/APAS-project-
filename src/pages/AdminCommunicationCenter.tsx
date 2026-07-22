/**
 * AdminCommunicationCenter.tsx
 * Admin / School Admin / Principal / HOD facing messaging hub.
 * Can message any Teacher, Parent, or Student in the school individually,
 * broadcast to "All Teachers" / "All Parents" / "All Students", or send a
 * single "Whole School" announcement across all three roles at once.
 * Reuses the same `teacher_messages` table as the other Communication
 * Center pages — `sender_id` here is just whichever admin-type role sent it.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Search, Send, Paperclip, Users, User, GraduationCap,
  MessageSquare, Check, CheckCheck, Smile, X, FileText, ChevronLeft, Megaphone,
  Image as ImageIcon,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { useNotifications } from "@/contexts/NotificationContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type ContactRole = "teacher" | "parent" | "student";

interface Contact {
  id: string; // profile id, or a synthetic "group-*" id for broadcast groups
  kind: "individual" | "group";
  role: ContactRole;
  name: string;
  subtitle?: string;
}

interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  recipient_role: string;
  message: string;
  message_type: string;
  attachment_url: string | null;
  attachment_name: string | null;
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

const roleBadgeColor: Record<ContactRole, string> = {
  teacher: "bg-amber-100 text-amber-700 border-amber-200",
  parent: "bg-blue-100 text-blue-700 border-blue-200",
  student: "bg-green-100 text-green-700 border-green-200",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dayLabel = (dateStr: string) => {
  const d = new Date(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "d MMM yyyy");
};

const isImageFile = (name?: string | null) =>
  !!name && /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name);
const isVideoFile = (name?: string | null) =>
  !!name && /\.(mp4|mov|webm|m4v|avi|3gp)$/i.test(name);

const WHOLE_SCHOOL_ID = "group-whole-school";

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminCommunicationCenter() {
  const { user, profile } = useAuth();
  const { markMessageNotificationsAsRead, setActiveMessageThreadId } = useNotifications();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [loadingContacts, setLoadingContacts] = useState(true);
  const [contactTab, setContactTab] = useState<ContactRole>("teacher");
  const [search, setSearch] = useState("");

  const [teacherContacts, setTeacherContacts] = useState<Contact[]>([]);
  const [parentContacts, setParentContacts] = useState<Contact[]>([]);
  const [studentContacts, setStudentContacts] = useState<Contact[]>([]);

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showMobileChat, setShowMobileChat] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const [lastMessages, setLastMessages] = useState<Map<string, Message>>(new Map());

  // ── Fetch every teacher / parent / student in this school ─────────────────
  const fetchContacts = useCallback(async () => {
    if (!user?.id || !profile?.school_id) return;
    setLoadingContacts(true);
    try {
      const { data: teachers } = await supabase
        .from("profiles")
        .select("id, full_name, designation")
        .eq("school_id", profile.school_id)
        .eq("role", "teacher");

      setTeacherContacts(
        (teachers || []).map((t: any) => ({
          id: t.id,
          kind: "individual" as const,
          role: "teacher" as const,
          name: t.full_name || "Unnamed Teacher",
          subtitle: t.designation || "Teacher",
        }))
      );

      const { data: parents } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("school_id", profile.school_id)
        .eq("role", "parent");

      setParentContacts(
        (parents || []).map((p: any) => ({
          id: p.id,
          kind: "individual" as const,
          role: "parent" as const,
          name: p.full_name || "Unnamed Parent",
          subtitle: "Parent",
        }))
      );

      const { data: students } = await supabase
        .from("profiles")
        .select("id, full_name, class_grade, section")
        .eq("school_id", profile.school_id)
        .eq("role", "student");

      setStudentContacts(
        (students || []).map((s: any) => ({
          id: s.id,
          kind: "individual" as const,
          role: "student" as const,
          name: s.full_name || "Unnamed Student",
          subtitle: s.class_grade ? `${s.class_grade}${s.section ? ` - ${s.section}` : ""}` : "Student",
        }))
      );

      // Last message per contact for previews
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

  useEffect(() => {
    return () => setActiveMessageThreadId(null);
  }, []);

  // ── Fetch thread for selected contact / group ───────────────────────────────
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

        const unreadIds = ((data || []) as any[])
          .filter(m => m.recipient_id === user.id && !m.is_read)
          .map(m => m.id);
        if (unreadIds.length > 0) {
          await supabase.from("teacher_messages" as any).update({ is_read: true }).in("id", unreadIds);
          setLastMessages((prev) => {
            const next = new Map(prev);
            const existing = next.get(contact.id);
            if (existing) next.set(contact.id, { ...existing, is_read: true });
            return next;
          });
        }
      } else {
        // Broadcast group: show this admin's own past broadcasts under this label
        const { data } = await supabase
          .from("teacher_messages" as any)
          .select("*")
          .eq("sender_id", user.id)
          .not("batch_id", "is", null)
          .order("created_at", { ascending: true });
        const label = contact.id === WHOLE_SCHOOL_ID ? "Whole School" : `All ${contact.role}s`;
        const filteredAll = ((data || []) as any[]).filter(m => m.broadcast_label === label);
        // Each broadcast inserts one row PER RECIPIENT (same batch_id) — keep
        // only one representative row per batch so the thread shows the
        // message once, not once per person it was sent to.
        const seenBatches = new Set<string>();
        const deduped = filteredAll.filter(m => {
          if (!m.batch_id || seenBatches.has(m.batch_id)) return false;
          seenBatches.add(m.batch_id);
          return true;
        });
        setMessages(deduped as Message[]);
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, selectedContact]);

  const openContact = (contact: Contact) => {
    setSelectedContact(contact);
    setShowMobileChat(true);
    setMessageText("");
    setAttachedFile(null);
    if (contact.kind === "individual") {
      markMessageNotificationsAsRead(contact.id);
      setActiveMessageThreadId(contact.id);
    } else {
      setActiveMessageThreadId(null);
    }
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

  const handleSend = async () => {
    if (!messageText.trim() && !attachedFile) {
      toast({ title: "Write a message or attach a file", variant: "destructive" });
      return;
    }
    if (!selectedContact || !user?.id || !profile?.school_id) return;

    setSending(true);
    try {
      let attachment: { url: string; name: string } | null = null;
      if (attachedFile) attachment = await uploadAttachment(attachedFile);
      const text = messageText.trim() || "📎 Attachment";

      if (selectedContact.kind === "individual") {
        const { error } = await supabase.from("teacher_messages" as any).insert({
          school_id: profile.school_id,
          sender_id: user.id,
          recipient_id: selectedContact.id,
          recipient_role: selectedContact.role,
          message: text,
          message_type: "general",
          attachment_url: attachment?.url || null,
          attachment_name: attachment?.name || null,
        });
        if (error) throw error;
      } else {
        // Broadcast: one row per recipient
        const batchId = crypto.randomUUID();
        let recipients: { id: string; role: ContactRole }[] = [];

        if (selectedContact.id === WHOLE_SCHOOL_ID) {
          recipients = [
            ...teacherContacts.map(c => ({ id: c.id, role: "teacher" as const })),
            ...parentContacts.map(c => ({ id: c.id, role: "parent" as const })),
            ...studentContacts.map(c => ({ id: c.id, role: "student" as const })),
          ];
        } else if (selectedContact.role === "teacher") {
          recipients = teacherContacts.map(c => ({ id: c.id, role: "teacher" as const }));
        } else if (selectedContact.role === "parent") {
          recipients = parentContacts.map(c => ({ id: c.id, role: "parent" as const }));
        } else {
          recipients = studentContacts.map(c => ({ id: c.id, role: "student" as const }));
        }

        if (recipients.length === 0) {
          toast({ title: "No recipients found", variant: "destructive" });
          setSending(false);
          return;
        }

        const label = selectedContact.id === WHOLE_SCHOOL_ID ? "Whole School" : `All ${selectedContact.role}s`;
        const rows = recipients.map(r => ({
          school_id: profile.school_id,
          sender_id: user.id,
          recipient_id: r.id,
          recipient_role: r.role,
          message: text,
          message_type: "general",
          attachment_url: attachment?.url || null,
          attachment_name: attachment?.name || null,
          batch_id: batchId,
          broadcast_label: label,
        }));

        const { error } = await supabase.from("teacher_messages" as any).insert(rows);
        if (error) throw error;

        toast({ title: `Sent to ${recipients.length} recipient(s)` });
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

  const currentContacts = useMemo(() => {
    let list: Contact[] =
      contactTab === "teacher" ? teacherContacts : contactTab === "parent" ? parentContacts : studentContacts;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.subtitle?.toLowerCase().includes(q));
    }
    return list;
  }, [contactTab, teacherContacts, parentContacts, studentContacts, search]);

  const groupForTab: Contact = useMemo(() => ({
    id: `group-all-${contactTab}`,
    kind: "group",
    role: contactTab,
    name: `All ${contactTab === "teacher" ? "Teachers" : contactTab === "parent" ? "Parents" : "Students"}`,
    subtitle: `Broadcast to every ${contactTab}`,
  }), [contactTab]);

  const wholeSchoolContact: Contact = {
    id: WHOLE_SCHOOL_ID,
    kind: "group",
    role: "teacher", // arbitrary — badge color only, recipients span all roles
    name: "Whole School",
    subtitle: "Broadcast to every teacher, parent & student",
  };

  return (
    <AppLayout>
      <div className="h-[calc(100vh-100px)] flex flex-col">
        <div className="rounded-2xl p-5 md:p-6 mb-4 relative overflow-hidden bg-gradient-to-r from-green-600 to-emerald-600 shadow-lg shrink-0">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <MessageSquare className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Communication Center</h1>
              <p className="text-green-100 text-xs md:text-sm mt-0.5">Message teachers, parents, and students in one place</p>
            </div>
          </div>
        </div>

        <Card className="flex-1 overflow-hidden border border-slate-200/70 rounded-2xl shadow-lg shadow-slate-200/50 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] h-full min-h-0">

            {/* ── Contact List Panel ── */}
            <div className={`min-h-0 border-r border-slate-100 bg-white flex flex-col ${showMobileChat ? "flex" : "hidden md:flex"}`}>
              <div className="p-3 border-b border-slate-100 space-y-2">
                <button
                  onClick={() => openContact(wholeSchoolContact)}
                  className={`w-full text-left p-2.5 rounded-xl flex items-center gap-3 transition-colors border ${
                    selectedContact?.id === WHOLE_SCHOOL_ID
                      ? "bg-emerald-50 border-emerald-200"
                      : "bg-emerald-50/40 border-emerald-100 hover:bg-emerald-50"
                  }`}
                >
                  <div className="h-11 w-11 rounded-full bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center shrink-0 shadow-sm">
                    <Megaphone className="h-4.5 w-4.5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate text-slate-800">Whole School</p>
                    <p className="text-xs text-muted-foreground truncate">Announce to everyone</p>
                  </div>
                </button>

                <div className="relative">
                  <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search teacher/parent/student"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9 h-10 text-sm rounded-full bg-slate-100 border-none focus-visible:ring-2 focus-visible:ring-green-300"
                  />
                </div>
              </div>

              <Tabs value={contactTab} onValueChange={(v: any) => setContactTab(v)} className="px-3 pt-3">
                <TabsList className="grid grid-cols-3 w-full h-9 bg-slate-100 rounded-full p-1">
                  <TabsTrigger value="teacher" className="text-xs gap-1 rounded-full data-[state=active]:bg-green-600 data-[state=active]:text-white data-[state=active]:shadow-sm">
                    <User className="h-3.5 w-3.5" /> Teachers
                  </TabsTrigger>
                  <TabsTrigger value="parent" className="text-xs gap-1 rounded-full data-[state=active]:bg-green-600 data-[state=active]:text-white data-[state=active]:shadow-sm">
                    <Users className="h-3.5 w-3.5" /> Parents
                  </TabsTrigger>
                  <TabsTrigger value="student" className="text-xs gap-1 rounded-full data-[state=active]:bg-green-600 data-[state=active]:text-white data-[state=active]:shadow-sm">
                    <GraduationCap className="h-3.5 w-3.5" /> Students
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {loadingContacts ? (
                  <div className="flex justify-center py-8"><LoadingSpinner /></div>
                ) : (
                  <>
                    {/* "All X" broadcast group for the active tab */}
                    <button
                      onClick={() => openContact(groupForTab)}
                      className={`w-full text-left p-2.5 rounded-xl flex items-center gap-3 transition-colors ${
                        selectedContact?.id === groupForTab.id ? "bg-green-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="h-11 w-11 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center shrink-0 shadow-sm">
                        <Users className="h-4.5 w-4.5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate text-slate-800">{groupForTab.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{groupForTab.subtitle}</p>
                      </div>
                    </button>

                    {currentContacts.length > 0 && <div className="h-px bg-border my-2" />}

                    {currentContacts.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        No contacts found.
                      </p>
                    ) : (
                      currentContacts.map(c => {
                        const isSelected = selectedContact?.id === c.id && selectedContact?.kind === "individual";
                        const last = lastMessages.get(c.id);
                        const isUnread = !!last && !last.is_read && last.recipient_id === user?.id;
                        return (
                          <button
                            key={c.id}
                            onClick={() => openContact(c)}
                            className={`w-full text-left p-2.5 rounded-xl flex items-center gap-3 transition-colors ${
                              isSelected ? "bg-green-50" : "hover:bg-slate-50"
                            }`}
                          >
                            <div className="h-11 w-11 rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center shrink-0 text-xs font-bold text-white shadow-sm">
                              {c.name[0]}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className={`text-sm truncate ${isUnread ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>{c.name}</p>
                                {last && (
                                  <span className={`text-[10px] shrink-0 ${isUnread ? "text-green-600 font-semibold" : "text-muted-foreground"}`}>
                                    {format(new Date(last.created_at), "h:mm a")}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center justify-between gap-2 mt-0.5">
                                <p className={`text-xs truncate ${isUnread ? "text-slate-700 font-medium" : "text-muted-foreground"}`}>
                                  {last ? last.message : c.subtitle}
                                </p>
                                {isUnread && (
                                  <span className="h-2.5 w-2.5 rounded-full bg-green-600 shrink-0" />
                                )}
                              </div>
                            </div>
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
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-slate-50/50">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center mb-4">
                    <MessageSquare className="h-9 w-9 text-green-500" />
                  </div>
                  <p className="text-sm font-medium text-slate-600">
                    Select a contact, a role group, or Whole School to start messaging
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your conversations and broadcasts will appear here.
                  </p>
                </div>
              ) : (
                <>
                  {/* Chat header */}
                  <div className="p-3 border-b border-slate-100 flex items-center gap-2.5 bg-gradient-to-r from-green-600 to-green-500">
                    <button className="md:hidden p-1 text-white" onClick={() => setShowMobileChat(false)}>
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-xs font-bold bg-white/20 text-white backdrop-blur-sm">
                      {selectedContact.kind === "group"
                        ? (selectedContact.id === WHOLE_SCHOOL_ID ? <Megaphone className="h-4.5 w-4.5" /> : <Users className="h-4.5 w-4.5" />)
                        : selectedContact.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate text-white">{selectedContact.name}</p>
                      <p className="text-xs text-white/75 truncate capitalize">
                        {selectedContact.subtitle || selectedContact.role}
                      </p>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[radial-gradient(circle,_#e2e8f0_1px,_transparent_1px)] [background-size:20px_20px] bg-green-50/30">
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
                            <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                              <div
                                className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 ${
                                  isMine
                                    ? "bg-green-600 text-white rounded-br-sm"
                                    : "bg-white border border-border/60 rounded-bl-sm"
                                }`}
                              >
                                {m.attachment_url && isImageFile(m.attachment_name) && (
                                  <a href={m.attachment_url} target="_blank" rel="noreferrer" className="block mb-1.5">
                                    <img
                                      src={m.attachment_url}
                                      alt={m.attachment_name || "Photo"}
                                      className="max-w-full max-h-64 rounded-lg object-cover"
                                    />
                                  </a>
                                )}
                                {m.attachment_url && isVideoFile(m.attachment_name) && (
                                  <video
                                    src={m.attachment_url}
                                    controls
                                    className="max-w-full max-h-64 rounded-lg mb-1.5"
                                  />
                                )}
                                {m.message && <p className="text-sm whitespace-pre-line">{m.message}</p>}
                                {m.attachment_url && !isImageFile(m.attachment_name) && !isVideoFile(m.attachment_name) && (
                                    <a
                                    href={m.attachment_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`flex items-center gap-1.5 mt-1.5 text-xs underline ${isMine ? "text-green-100" : "text-green-700"}`}
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    {m.attachment_name || "Attachment"}
                                  </a>
                                )}
                                <div className={`flex items-center gap-1 mt-1 ${isMine ? "justify-end" : "justify-start"}`}>
                                  <span className={`text-[10px] ${isMine ? "text-green-100" : "text-muted-foreground"}`}>
                                    {format(new Date(m.created_at), "h:mm a")}
                                  </span>
                                  {isMine && (
                                    m.is_read
                                      ? <CheckCheck className="h-3 w-3 text-sky-300" />
                                      : <Check className="h-3 w-3 text-green-100" />
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
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
                      {isImageFile(attachedFile.name) ? (
                        <div className="relative inline-block">
                          <img
                            src={URL.createObjectURL(attachedFile)}
                            alt={attachedFile.name}
                            className="h-24 w-24 object-cover rounded-lg border border-border/60"
                          />
                          <button
                            onClick={() => setAttachedFile(null)}
                            className="absolute -top-1.5 -right-1.5 bg-slate-800 text-white rounded-full p-0.5 shadow"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : isVideoFile(attachedFile.name) ? (
                        <div className="relative inline-block">
                          <video
                            src={URL.createObjectURL(attachedFile)}
                            className="h-24 w-24 object-cover rounded-lg border border-border/60"
                            muted
                          />
                          <button
                            onClick={() => setAttachedFile(null)}
                            className="absolute -top-1.5 -right-1.5 bg-slate-800 text-white rounded-full p-0.5 shadow"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 text-xs">
                          <FileText className="h-3.5 w-3.5" />
                          {attachedFile.name}
                          <button onClick={() => setAttachedFile(null)}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Compose bar */}
                  <div className="p-3 border-t border-slate-100 bg-white flex items-end gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) setAttachedFile(f);
                        e.target.value = "";
                      }}
                    />
                    <input
                      ref={mediaInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*,video/*"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) setAttachedFile(f);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 rounded-full text-slate-500 hover:bg-slate-100"
                      onClick={() => mediaInputRef.current?.click()}
                      title="Photo or video"
                    >
                      <ImageIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 rounded-full text-slate-500 hover:bg-slate-100"
                      onClick={() => fileInputRef.current?.click()}
                      title="Attach file"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 rounded-full text-slate-500 hover:bg-slate-100"
                      onClick={() => setShowEmojiPicker(v => !v)}
                      title="Insert emoji"
                    >
                      <Smile className="h-4 w-4" />
                    </Button>
                    <Textarea
                      placeholder={selectedContact.kind === "group" ? "Write a broadcast message..." : "Type a message..."}
                      value={messageText}
                      onChange={e => setMessageText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      rows={1}
                      className="resize-none min-h-[40px] max-h-32 text-sm rounded-2xl bg-slate-100 border-none focus-visible:ring-2 focus-visible:ring-green-300 px-4 py-2.5"
                    />
                    <Button
                      onClick={handleSend}
                      disabled={sending || uploadingFile}
                      className="shrink-0 gap-1.5 rounded-full h-10 w-10 p-0 bg-gradient-to-br from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 shadow-sm shadow-green-200"
                    >
                      {sending || uploadingFile ? <LoadingSpinner size="sm" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
