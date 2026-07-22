/**
 * ParentCommunicationCenter.tsx
 * Parent-facing messaging hub: Parent <-> their children's Teachers.
 * Reuses the same `teacher_messages` table as the teacher-side Communication
 * Center, just scoped to a 1:1 view with each teacher.
 *
 * DESIGN NOTE: visual layer only — every hook, handler, and Supabase call
 * below is identical to the original. Only classNames / markup changed.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Search, Send, Paperclip, MessageSquare, Check, CheckCheck,
  Calendar as CalendarIcon, Smile, X, FileText, ChevronLeft, Trash2,
  Megaphone, Image as ImageIcon,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { getMyChildren, getTeachersForChild } from "@/lib/appointments";
import { useNotifications } from "@/contexts/NotificationContext";
// ─── Types ────────────────────────────────────────────────────────────────────

interface TeacherContact {
  id: string; // teacher profile id
  name: string;
  subtitle: string; // e.g. "Teaches Varun Gupta (Nursery - A)"
  role: string; // "teacher" | "admin" | "principal" | "school_admin" | "hod"
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
  is_read: boolean;
  created_at: string;
}

const QUICK_EMOJIS = [
  "😀", "😊", "😂", "🙂", "😉", "😍", "🤗", "😢", "😮", "🤔",
  "👍", "👏", "🙌", "💪", "🙏", "👋", "✅", "❌", "⭐", "🎉",
  "❤️", "💯", "🔥", "📚", "✏️", "📝", "📌", "⏰", "📅", "🏆",
];

// ─── Palette ──────────────────────────────────────────────────────────────────
// A vivid "indigo-to-blue" identity — an indigo→cobalt gradient chrome with
// a bright sky-blue accent for actions/unread, and a matching indigo-blue
// gradient for the parent's own messages. Kept off the templated
// cream+terracotta/near-black+neon defaults, and off flat single-tone blue.
const INDIGO_DEEP = "#4338CA"; // header gradient start
const BLUE_MID = "#2563EB";    // header gradient end / selected accents
const SKY_ACCENT = "#0EA5E9";  // bright accent — CTAs, unread, send button
const SKY_SOFT = "#93D8F7";
const SEA_DEEP = "#4338CA";    // sent bubble start
const SEA_BRIGHT = "#2563EB";  // sent bubble end
const MIST = "#F3F7FF";        // chat canvas
const OCHRE = "#B8842A";       // notice accents

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

const NOTICE_ROLES = new Set(["admin", "principal", "school_admin", "hod"]);

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParentCommunicationCenter() {
  const { user, profile } = useAuth();
  const { markMessageNotificationsAsRead, setActiveMessageThreadId } = useNotifications();
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [loadingContacts, setLoadingContacts] = useState(true);
  const [search, setSearch] = useState("");
  const [teacherContacts, setTeacherContacts] = useState<TeacherContact[]>([]);

  const [selectedContact, setSelectedContact] = useState<TeacherContact | null>(null);
  const [showMobileChat, setShowMobileChat] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const [lastMessages, setLastMessages] = useState<Map<string, Message>>(new Map());

  // ── Fetch teacher contacts across all of the parent's children ─────────────
  const fetchContacts = useCallback(async () => {
    if (!user?.id) return;
    setLoadingContacts(true);
    try {
      const children = await getMyChildren(user.id);

      const teacherMap = new Map<string, TeacherContact>();
      for (const child of children) {
        if (!child.className) continue;
        const teachers = await getTeachersForChild(child.className, child.section, child.schoolId);
        for (const t of teachers) {
          const existing = teacherMap.get(t.teacherId);
          const childLabel = `${child.fullName} (${child.className}${child.section ? ` - ${child.section}` : ""})`;
          if (existing) {
            existing.subtitle = existing.subtitle.includes(childLabel)
              ? existing.subtitle
              : `${existing.subtitle}, ${childLabel}`;
          } else {
            teacherMap.set(t.teacherId, {
              id: t.teacherId,
              name: t.fullName,
              subtitle: `Teaches ${childLabel}`,
              role: "teacher",
            });
          }
        }
      }
      // Also surface anyone who has messaged this student but isn't one of
      // their assigned teachers — e.g. an admin/principal/HOD broadcast.
      const { data: otherSenders } = await supabase
        .from("teacher_messages" as any)
        .select("sender_id")
        .eq("recipient_id", user.id);

      const extraSenderIds = [
        ...new Set(((otherSenders || []) as any[]).map(m => m.sender_id)),
      ].filter(id => !teacherMap.has(id));

      if (extraSenderIds.length > 0) {
        const { data: extraProfiles } = await supabase
          .from("profiles")
          .select("id, full_name, role")
          .in("id", extraSenderIds);

        const roleLabel: Record<string, string> = {
          admin: "Admin",
          principal: "Principal",
          school_admin: "School Admin",
          hod: "Head of Department",
          teacher: "Teacher",
        };

        for (const p of extraProfiles || []) {
          teacherMap.set(p.id, {
            id: p.id,
            name: p.full_name || "Unnamed",
            subtitle: roleLabel[p.role] || p.role,
            role: p.role,
          });
        }
      }

      setTeacherContacts([...teacherMap.values()]);

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
      toast({ title: "Error loading teachers", description: e.message, variant: "destructive" });
    } finally {
      setLoadingContacts(false);
    }
  }, [user?.id, toast]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);
  useEffect(() => {
    return () => setActiveMessageThreadId(null);
  }, []);

  // ── Fetch thread for selected teacher ───────────────────────────────────────
  const fetchThread = useCallback(async (contact: TeacherContact) => {
    if (!user?.id) return;
    setThreadLoading(true);
    try {
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

  const openContact = (contact: TeacherContact) => {
    setSelectedContact(contact);
    setShowMobileChat(true);
    setMessageText("");
    setAttachedFile(null);
    markMessageNotificationsAsRead(contact.id);
    setActiveMessageThreadId(contact.id);
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

      const { error } = await supabase.from("teacher_messages" as any).insert({
        school_id: profile.school_id,
        sender_id: user.id,
        recipient_id: selectedContact.id,
        recipient_role: selectedContact.role,
        message: messageText.trim() || "📎 Attachment",
        message_type: "general",
        attachment_url: attachment?.url || null,
        attachment_name: attachment?.name || null,
      });
      if (error) throw error;

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

  const handleDeleteMessage = async (messageId: string) => {
    if (!window.confirm("Delete this message? This cannot be undone.")) return;
    try {
      const { error } = await supabase.from("teacher_messages" as any).delete().eq("id", messageId);
      if (error) throw error;
      setMessages(prev => prev.filter(m => m.id !== messageId));
      if (selectedContact) fetchContacts();
    } catch (e: any) {
      toast({ title: "Couldn't delete message", description: e.message, variant: "destructive" });
    }
  };

  const currentContacts = useMemo(() => {
    if (!search.trim()) return teacherContacts;
    const q = search.toLowerCase();
    return teacherContacts.filter(c => c.name.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q));
  }, [teacherContacts, search]);

  return (
    <AppLayout>
      <div className="h-[calc(100vh-100px)] flex flex-col">
        {/* Page header */}
        <div
          className="rounded-2xl p-5 md:p-6 mb-4 relative overflow-hidden shadow-lg shrink-0"
          style={{ backgroundImage: `linear-gradient(120deg, ${INDIGO_DEEP}, ${BLUE_MID})` }}
        >
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "16px 16px" }}
          />
          <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full" style={{ backgroundColor: `${SKY_ACCENT}26` }} />
          <div className="absolute right-20 top-10 w-16 h-16 rounded-full" style={{ backgroundColor: "#ffffff14" }} />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div
              className="w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center shrink-0 shadow-md"
              style={{ backgroundImage: `linear-gradient(135deg, ${SKY_ACCENT}, #38BDF8)` }}
            >
              <MessageSquare className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-serif font-semibold text-white tracking-tight">
                Communication Center
              </h1>
              <p className="text-xs md:text-sm mt-0.5" style={{ color: "#CBDBF2" }}>
                Messages with your child's teachers
              </p>
            </div>
          </div>
        </div>
 
        <Card
          className="flex-1 overflow-hidden rounded-2xl shadow-xl min-h-0 border-0"
          style={{ boxShadow: `0 20px 45px -20px ${INDIGO_DEEP}55` }}
        >
          <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] h-full min-h-0">

            {/* ── Contact List Panel ── */}
            <div className={`min-h-0 border-r flex flex-col bg-white ${showMobileChat ? "hidden md:flex" : "flex"}`} style={{ borderColor: "#DCE7F5" }}>
              <div className="p-3 border-b" style={{ borderColor: "#DCE7F5" }}>
                <div className="relative">
                  <Search className="absolute left-3.5 top-2.5 h-4 w-4" style={{ color: `${BLUE_MID}99` }} />
                  <Input
                    placeholder="Search teachers"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9 h-10 text-sm rounded-full border-none focus-visible:ring-2"
                    style={{ backgroundColor: "#EAF1FA", boxShadow: "none" } as React.CSSProperties}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {loadingContacts ? (
                  <div className="flex justify-center py-8"><LoadingSpinner /></div>
                ) : currentContacts.length === 0 ? (
                  <div className="text-center py-10 px-4">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      No teachers linked yet. They'll show up here once your child
                      is assigned to a class.
                    </p>
                  </div>
                ) : (
                  currentContacts.map(c => {
                    const isSelected = selectedContact?.id === c.id;
                    const last = lastMessages.get(c.id);
                    const isNotice = NOTICE_ROLES.has(c.role);
                    const isUnread = !!(last && !last.is_read && last.recipient_id === user?.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => openContact(c)}
                        className="w-full text-left p-2.5 rounded-xl flex items-center gap-3 transition-colors relative"
                        style={isSelected ? { backgroundColor: "#E7EFFA" } : undefined}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "#F1F6FC"; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = ""; }}
                      >
                        {isSelected && (
                          <span
                            className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
                            style={{ backgroundColor: SKY_ACCENT }}
                          />
                        )}
                        <div
                          className="h-11 w-11 rounded-full flex items-center justify-center shrink-0 text-xs font-serif font-bold text-white shadow-sm"
                          style={{ backgroundImage: `linear-gradient(135deg, ${BLUE_MID}, ${SKY_ACCENT})` }}
                        >
                          {c.name[0]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className={`text-sm truncate font-serif ${isUnread ? "font-bold" : "font-semibold"}`} style={{ color: isUnread ? INDIGO_DEEP : "#132B4C" }}>
                                {c.name}
                              </p>
                              {isNotice && (
                                <span
                                  className="shrink-0 text-[9px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded-full"
                                  style={{ backgroundColor: `${OCHRE}1F`, color: OCHRE }}
                                >
                                  Notice
                                </span>
                              )}
                            </div>
                            {last && (
                              <span className="text-[10px] shrink-0" style={{ color: isUnread ? SKY_ACCENT : "#7C93B5", fontWeight: isUnread ? 600 : 400 }}>
                                {format(new Date(last.created_at), "h:mm a")}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <p className="text-xs truncate" style={{ color: isUnread ? "#33507A" : "#7C93B5", fontWeight: isUnread ? 500 : 400 }}>
                              {last ? last.message : c.subtitle}
                            </p>
                            {isUnread && (
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: SKY_ACCENT }} />
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* ── Chat Panel ── */}
            <div className={`min-h-0 flex flex-col ${showMobileChat ? "flex" : "hidden md:flex"}`}>
              {!selectedContact ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6" style={{ backgroundColor: "#F7FAFD" }}>
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
                    style={{ backgroundImage: `linear-gradient(135deg, ${BLUE_MID}22, ${SKY_ACCENT}22)` }}
                  >
                    <MessageSquare className="h-9 w-9" style={{ color: BLUE_MID }} />
                  </div>
                  <p className="text-sm font-serif font-medium" style={{ color: "#33507A" }}>
                    Choose a teacher to see your conversation
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your messages with your child's teachers will appear here.
                  </p>
                </div>
              ) : (
                <>
                  {/* Chat header */}
                  <div
                    className="p-3 border-b flex items-center gap-2.5"
                    style={{ backgroundImage: `linear-gradient(120deg, ${INDIGO_DEEP}, ${BLUE_MID})`, borderColor: "transparent" }}
                  >
                    <button className="md:hidden p-1 text-white" onClick={() => setShowMobileChat(false)}>
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <div
                      className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-xs font-serif font-bold text-white"
                      style={{ backgroundColor: "#ffffff26" }}
                    >
                      {selectedContact.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-serif font-semibold truncate text-white">{selectedContact.name}</p>
                      <p className="text-xs truncate" style={{ color: "#CBDBF2" }}>{selectedContact.subtitle}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs text-white hover:text-white"
                      style={{ backgroundColor: "#ffffff1A", borderColor: "#ffffff4D" }}
                      onClick={() => navigate("/appointments")}
                    >
                      <CalendarIcon className="h-3.5 w-3.5" />
                      Appointments
                    </Button>
                  </div>

                  {/* Messages */}
                  <div
                    className="flex-1 overflow-y-auto p-4 space-y-3"
                    style={{
                      backgroundColor: MIST,
                      backgroundImage: `radial-gradient(circle, ${BLUE_MID}14 1px, transparent 1px)`,
                      backgroundSize: "20px 20px",
                    }}
                  >
                    {threadLoading ? (
                      <div className="flex justify-center py-8"><LoadingSpinner /></div>
                    ) : messages.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        No messages yet. Say hello below.
                      </p>
                    ) : (
                      messages.map((m, i) => {
                        const isMine = m.sender_id === user?.id;
                        const showDateSep = i === 0 || dayLabel(messages[i - 1].created_at) !== dayLabel(m.created_at);
                        return (
                          <div key={m.id}>
                            {showDateSep && (
                              <div className="flex justify-center my-3">
                                <span
                                  className="text-[10px] font-serif uppercase tracking-wider px-3 py-1 rounded-full border shadow-sm bg-white"
                                  style={{ color: BLUE_MID, borderColor: `${BLUE_MID}33` }}
                                >
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
                                className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 shadow-sm ${
                                  isMine ? "text-white rounded-br-sm" : "bg-white rounded-bl-sm border"
                                }`}
                                style={
                                  isMine
                                    ? { backgroundImage: `linear-gradient(135deg, ${SEA_DEEP}, ${SEA_BRIGHT})` }
                                    : { borderColor: "#DCE7F5" }
                                }
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
                                    className="flex items-center gap-1.5 mt-1.5 text-xs underline"
                                    style={{ color: isMine ? SKY_SOFT : BLUE_MID }}
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    {m.attachment_name || "Attachment"}
                                  </a>
                                )}
                                <div className={`flex items-center gap-1 mt-1 ${isMine ? "justify-end" : "justify-start"}`}>
                                  <span
                                    className="text-[10px] font-mono tracking-wide"
                                    style={{ color: isMine ? "#BBD3F0" : "#7C93B5" }}
                                  >
                                    {format(new Date(m.created_at), "h:mm a")}
                                  </span>
                                  {isMine && (
                                    m.is_read
                                      ? <CheckCheck className="h-3 w-3" style={{ color: SKY_SOFT }} />
                                      : <Check className="h-3 w-3" style={{ color: "#BBD3F0" }} />
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
                      <div
                        className="flex flex-wrap gap-1.5 rounded-xl p-2.5 bg-white max-w-xs shadow-sm border"
                        style={{ borderColor: "#DCE7F5" }}
                      >
                        {QUICK_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setMessageText((prev) => prev + emoji)}
                            className="text-lg rounded p-1 transition-colors"
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#EAF1FA")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
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
                            className="h-24 w-24 object-cover rounded-lg border"
                            style={{ borderColor: "#DCE7F5" }}
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
                            className="h-24 w-24 object-cover rounded-lg border"
                            style={{ borderColor: "#DCE7F5" }}
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
                        <div
                          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
                          style={{ backgroundColor: "#E7EFFA", color: BLUE_MID }}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          {attachedFile.name}
                          <button onClick={() => setAttachedFile(null)}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Compose bar — students can only reply to teachers, not admin/principal/school_admin/hod broadcasts */}
                  {selectedContact.role === "teacher" ? (
                    <div className="p-3 border-t bg-white flex items-end gap-2" style={{ borderColor: "#DCE7F5" }}>
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
                        className="shrink-0 rounded-full"
                        style={{ color: BLUE_MID }}
                        onClick={() => mediaInputRef.current?.click()}
                        title="Photo or video"
                      >
                        <ImageIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 rounded-full"
                        style={{ color: BLUE_MID }}
                        onClick={() => fileInputRef.current?.click()}
                        title="Attach file"
                      >
                        <Paperclip className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 rounded-full"
                        style={{ color: BLUE_MID }}
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
                        className="resize-none min-h-[40px] max-h-32 text-sm rounded-2xl border-none focus-visible:ring-2 px-4 py-2.5"
                        style={{ backgroundColor: "#EAF1FA" } as React.CSSProperties}
                      />
                      <Button
                        onClick={() => handleSend()}
                        disabled={sending || uploadingFile}
                        className="shrink-0 gap-1.5 rounded-full h-10 w-10 p-0 text-white shadow-sm border-0"
                        style={{ backgroundImage: `linear-gradient(135deg, ${SKY_ACCENT}, #38BDF8)` }}
                      >
                        {sending || uploadingFile ? <LoadingSpinner size="sm" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                  ) : (
                    <div
                      className="p-3 border-t flex items-center justify-center gap-1.5 text-center text-xs"
                      style={{ backgroundColor: `${OCHRE}12`, color: "#33507A", borderColor: "#DCE7F5" }}
                    >
                      <Megaphone className="h-3.5 w-3.5 shrink-0" style={{ color: OCHRE }} />
                      This is a notice from {selectedContact.subtitle || "the school"} — replies aren't available here.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
