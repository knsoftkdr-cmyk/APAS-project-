/**
 * StudentCommunicationCenter.tsx
 * Student-facing messaging hub: Student <-> their own Teachers.
 * Same pattern as ParentCommunicationCenter, but contacts are derived from
 * the student's own class/section instead of a parent's linked children.
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
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Search, Send, Paperclip, MessageSquare, Check, CheckCheck,
  Smile, X, FileText, ChevronLeft, Image as ImageIcon,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { getTeachersForChild } from "@/lib/appointments";
import { useNotifications } from "@/contexts/NotificationContext";

// ─── Types ──────────────────────────────────────────────────────────

interface TeacherContact {
  id: string; // teacher profile id
  name: string;
  subtitle: string; // e.g. "Class 6 - A · Mathematics"
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

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function StudentCommunicationCenter() {
  const { user, profile } = useAuth();
  const { markMessageNotificationsAsRead, setActiveMessageThreadId } = useNotifications();
  const { toast } = useToast();
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

  // ── Fetch this student's own teachers ───────────────────────────────────────
  const fetchContacts = useCallback(async () => {
    if (!user?.id) return;
    setLoadingContacts(true);
    try {
      // Pull class_grade/section/school_id fresh from profiles rather than
      // trusting the AuthContext profile object to carry every column.
      const { data: ownProfile } = await supabase
        .from("profiles")
        .select("class_grade, section, school_id")
        .eq("id", user.id)
        .maybeSingle();

      const teacherMap = new Map<string, TeacherContact>();
      if (ownProfile?.class_grade && ownProfile?.school_id) {
        const teachers = await getTeachersForChild(
          ownProfile.class_grade,
          ownProfile.section || "",
          ownProfile.school_id
        );
        for (const t of teachers) {
          teacherMap.set(t.teacherId, {
            id: t.teacherId,
            name: t.fullName,
            subtitle: t.subject
              ? `${t.subject}${t.designation ? ` · ${t.designation}` : ""}`
              : t.designation || "Your teacher",
            role: "teacher",
          });
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

  const currentContacts = useMemo(() => {
    if (!search.trim()) return teacherContacts;
    const q = search.toLowerCase();
    return teacherContacts.filter(c => c.name.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q));
  }, [teacherContacts, search]);

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
              <p className="text-green-100 text-xs md:text-sm mt-0.5">Message your teachers in one place</p>
            </div>
          </div>
        </div>

        <Card className="flex-1 overflow-hidden border border-slate-200/70 rounded-2xl shadow-lg shadow-slate-200/50 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] h-full min-h-0">

            {/* ── Contact List Panel ── */}
            <div className={`border-r border-slate-100 bg-white flex flex-col ${showMobileChat ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 border-b border-slate-100">
                <div className="relative">
                  <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search teacher"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9 h-10 text-sm rounded-full bg-slate-100 border-none focus-visible:ring-2 focus-visible:ring-green-300"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {loadingContacts ? (
                  <div className="flex justify-center py-8"><LoadingSpinner /></div>
                ) : currentContacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    No teachers found yet.
                  </p>
                ) : (
                  currentContacts.map(c => {
                    const isSelected = selectedContact?.id === c.id;
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
                    Select a teacher to start messaging
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your conversations with teachers will appear here.
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
                      {selectedContact.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate text-white">{selectedContact.name}</p>
                      <p className="text-xs text-white/75 truncate">{selectedContact.subtitle}</p>
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

                  {/* Compose bar — students can only reply to teachers, not admin/principal/school_admin/hod broadcasts */}
                  {selectedContact.role === "teacher" ? (
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
                  ) : (
                    <div className="p-3 border-t border-slate-100 text-center text-xs text-muted-foreground bg-muted/30">
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
