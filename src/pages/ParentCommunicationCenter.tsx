/**
 * ParentCommunicationCenter.tsx
 * Parent-facing messaging hub: Parent <-> their children's Teachers.
 * Reuses the same `teacher_messages` table as the teacher-side Communication
 * Center, just scoped to a 1:1 view with each teacher.
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
  Calendar as CalendarIcon, Smile, X, FileText, ChevronLeft,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { getMyChildren, getTeachersForChild } from "@/lib/appointments";
import { useNotifications } from "@/contexts/NotificationContext";
// ─── Types ────────────────────────────────────────────────────────────────────

interface TeacherContact {
  id: string; // teacher profile id
  name: string;
  subtitle: string; // e.g. "Teaches Varun Gupta (Nursery - A)"
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dayLabel = (dateStr: string) => {
  const d = new Date(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "d MMM yyyy");
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParentCommunicationCenter() {
  const { user, profile } = useAuth();
  const { markMessageNotificationsAsRead, setActiveMessageThreadId } = useNotifications();
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
            });
          }
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
        recipient_role: "teacher",
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
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-blue-600" />
          <h1 className="text-xl font-bold text-foreground">Communication Center</h1>
        </div>

        <Card className="flex-1 overflow-hidden border border-border/60">
          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] h-full">

            {/* ── Contact List Panel ── */}
            <div className={`border-r border-border/60 flex flex-col ${showMobileChat ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 border-b border-border/60">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search teacher"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8 h-9 text-sm"
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
              </div>
            </div>

            {/* ── Chat Panel ── */}
            <div className={`flex flex-col ${showMobileChat ? "flex" : "hidden md:flex"}`}>
              {!selectedContact ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <MessageSquare className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Select a teacher to start messaging
                  </p>
                </div>
              ) : (
                <>
                  {/* Chat header */}
                  <div className="p-3 border-b border-border/60 flex items-center gap-2.5">
                    <button className="md:hidden p-1" onClick={() => setShowMobileChat(false)}>
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <div className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold bg-blue-100 text-blue-700">
                      {selectedContact.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{selectedContact.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{selectedContact.subtitle}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs"
                      onClick={() => navigate("/appointments")}
                    >
                      <CalendarIcon className="h-3.5 w-3.5" />
                      Appointments
                    </Button>
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
                            <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                              <div
                                className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 ${
                                  isMine
                                    ? "bg-blue-600 text-white rounded-br-sm"
                                    : "bg-white border border-border/60 rounded-bl-sm"
                                }`}
                              >
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
                      onClick={handleSend}
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
      </div>
    </AppLayout>
  );
}