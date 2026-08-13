/**
 * DriverCommunicationCenter.tsx
 * Driver-facing messaging hub: Driver <-> School Admin/Principal, and
 * Driver <-> Parents of students on the driver's own transport routes.
 * Reuses the same `teacher_messages` table as every other Communication
 * Center page — sender_id/recipient_id are just profile ids (auth.uid()).
 *
 * Phase 1: individual chat only. Broadcast Messages and Voice Announcements
 * come in a later pass.
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
  Smile, X, FileText, ChevronLeft, ShieldCheck, Users, Megaphone,
  Image as ImageIcon, Mic, Square,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { getParentsForDriver } from "@/lib/transport";
import { useNotifications } from "@/contexts/NotificationContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type ContactRole = "admin" | "parent";

interface Contact {
  id: string; // profile id, or ALL_PARENTS_ID for the broadcast group
  kind: "individual" | "group";
  name: string;
  subtitle: string;
  role: ContactRole;
}

const ALL_PARENTS_ID = "group-all-parents";

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

const roleBadgeColor: Record<ContactRole, string> = {
  admin: "bg-amber-100 text-amber-700 border-amber-200",
  parent: "bg-blue-100 text-blue-700 border-blue-200",
};

const roleLabel: Record<string, string> = {
  admin: "Admin",
  principal: "Principal",
  school_admin: "School Admin",
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
// Recorded voice notes are saved as .webm too (same container as video), so
// distinguish them by a dedicated filename prefix instead of extension.
const isVoiceNote = (name?: string | null) => !!name && name.startsWith("voice-note-");

// ─── Component ────────────────────────────────────────────────────────────────

export default function DriverCommunicationCenter() {
  const { user, profile } = useAuth();
  const { markMessageNotificationsAsRead, setActiveMessageThreadId } = useNotifications();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [loadingContacts, setLoadingContacts] = useState(true);
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [parentCount, setParentCount] = useState(0);

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showMobileChat, setShowMobileChat] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [lastMessages, setLastMessages] = useState<Map<string, Message>>(new Map());

  // ── Fetch admin/principal/school_admin staff + parents on this driver's routes ──
  const fetchContacts = useCallback(async () => {
    if (!user?.id || !profile?.school_id) return;
    setLoadingContacts(true);
    try {
      const contactMap = new Map<string, Contact>();

      const { data: staff } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("school_id", profile.school_id)
        .in("role", ["admin", "principal", "school_admin"]);

      for (const s of staff || []) {
        contactMap.set(s.id, {
          id: s.id,
          kind: "individual",
          name: s.full_name || "Unnamed",
          subtitle: roleLabel[s.role] || s.role,
          role: "admin",
        });
      }

      const parentContacts = await getParentsForDriver(user.id);
      for (const p of parentContacts) {
        contactMap.set(p.parentProfileId, {
          id: p.parentProfileId,
          kind: "individual",
          name: p.name,
          subtitle: `Parent of ${p.studentName} (${p.routeLabel})`,
          role: "parent",
        });
      }
      setParentCount(parentContacts.length);

      setContacts([...contactMap.values()]);

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
        // Broadcast group: show this driver's own past "All Parents" broadcasts
        const { data } = await supabase
          .from("teacher_messages" as any)
          .select("*")
          .eq("sender_id", user.id)
          .eq("broadcast_label", "All Parents")
          .not("batch_id", "is", null)
          .order("created_at", { ascending: true });
        // Each broadcast inserts one row PER RECIPIENT (same batch_id) — keep
        // only one representative row per batch so the thread shows the
        // message once, not once per parent it was sent to.
        const seenBatches = new Set<string>();
        const deduped = ((data || []) as any[]).filter(m => {
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
          recipient_role: selectedContact.role === "admin" ? "admin" : "parent",
          message: text,
          message_type: "general",
          attachment_url: attachment?.url || null,
          attachment_name: attachment?.name || null,
        });
        if (error) throw error;
      } else {
        // Broadcast: one row per parent contact on this driver's routes
        const parentRecipients = contacts.filter(c => c.kind === "individual" && c.role === "parent");
        if (parentRecipients.length === 0) {
          toast({ title: "No parents found on your routes", variant: "destructive" });
          setSending(false);
          return;
        }
        const batchId = crypto.randomUUID();
        const rows = parentRecipients.map(r => ({
          school_id: profile.school_id,
          sender_id: user.id,
          recipient_id: r.id,
          recipient_role: "parent",
          message: text,
          message_type: "general",
          attachment_url: attachment?.url || null,
          attachment_name: attachment?.name || null,
          batch_id: batchId,
          broadcast_label: "All Parents",
        }));
        const { error } = await supabase.from("teacher_messages" as any).insert(rows);
        if (error) throw error;
        toast({ title: `Sent to ${parentRecipients.length} parent(s)` });
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

  // ── Voice recording ──────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: "audio/webm" });
        setAttachedFile(file);
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingIntervalRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } catch (e: any) {
      toast({ title: "Microphone access denied", description: e.message || "Couldn't access your microphone.", variant: "destructive" });
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    };
  }, []);

  const currentContacts = useMemo(() => {
    let list = contacts;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.subtitle?.toLowerCase().includes(q));
    }
    return list;
  }, [contacts, search]);

  const allParentsContact: Contact = {
    id: ALL_PARENTS_ID,
    kind: "group",
    role: "parent",
    name: "All Parents",
    subtitle: `Broadcast to every parent on your routes (${parentCount})`,
  };

  return (
    <AppLayout>
      <div className="h-[calc(100vh-100px)] flex flex-col">
        <div className="rounded-2xl p-5 md:p-6 mb-4 relative overflow-hidden bg-gradient-to-r from-purple-600 to-indigo-600 shadow-lg shrink-0">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <MessageSquare className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Communication Center</h1>
              <p className="text-purple-100 text-xs md:text-sm mt-0.5">Message school admins and parents on your routes</p>
            </div>
          </div>
        </div>

        <Card className="flex-1 overflow-hidden border border-slate-200/70 rounded-2xl shadow-lg shadow-slate-200/50 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] h-full min-h-0">

            {/* ── Contact List Panel ── */}
            <div className={`min-h-0 border-r border-slate-100 bg-white flex flex-col ${showMobileChat ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 border-b border-slate-100 space-y-2">
                <button
                  onClick={() => openContact(allParentsContact)}
                  className={`w-full text-left p-2.5 rounded-xl flex items-center gap-3 transition-colors border ${
                    selectedContact?.id === ALL_PARENTS_ID
                      ? "bg-purple-50 border-purple-200"
                      : "bg-purple-50/40 border-purple-100 hover:bg-purple-50"
                  }`}
                >
                  <div className="h-11 w-11 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center shrink-0 shadow-sm">
                    <Megaphone className="h-4.5 w-4.5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate text-slate-800">All Parents</p>
                    <p className="text-xs text-muted-foreground truncate">{allParentsContact.subtitle}</p>
                  </div>
                </button>

                <div className="relative">
                  <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search admin/parent"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9 h-10 text-sm rounded-full bg-slate-100 border-none focus-visible:ring-2 focus-visible:ring-purple-300"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {loadingContacts ? (
                  <div className="flex justify-center py-8"><LoadingSpinner /></div>
                ) : currentContacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    No contacts found.
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
                          isSelected ? "bg-purple-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="h-11 w-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shrink-0 shadow-sm text-white font-semibold">
                          {c.role === "admin" ? <ShieldCheck className="h-4.5 w-4.5" /> : c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold truncate text-slate-800">{c.name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${roleBadgeColor[c.role]}`}>
                              {c.role === "admin" ? "Staff" : "Parent"}
                            </span>
                          </div>
                          <p className={`text-xs truncate ${isUnread ? "font-semibold text-slate-700" : "text-muted-foreground"}`}>
                            {last ? last.message : c.subtitle}
                          </p>
                        </div>
                        {isUnread && <div className="h-2 w-2 rounded-full bg-purple-500 shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* ── Chat Panel ── */}
            <div className={`min-h-0 flex flex-col ${showMobileChat ? "flex" : "hidden md:flex"}`}>
              {!selectedContact ? (
                <div className="flex-1 flex items-center justify-center flex-col gap-2 text-center p-8">
                  <div className="h-16 w-16 rounded-full bg-purple-50 flex items-center justify-center mb-2">
                    <MessageSquare className="h-7 w-7 text-purple-400" />
                  </div>
                  <p className="text-slate-700 font-medium">Choose a contact to see your conversation</p>
                  <p className="text-sm text-muted-foreground">Your messages with school staff and parents will appear here.</p>
                </div>
              ) : (
                <>
                  <div className="p-3 border-b border-slate-100 flex items-center gap-3 shrink-0">
                    <button className="md:hidden p-1" onClick={() => setShowMobileChat(false)}>
                      <ChevronLeft className="h-5 w-5 text-slate-500" />
                    </button>
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shrink-0 shadow-sm text-white font-semibold text-sm">
                      {selectedContact.kind === "group" ? (
                        <Megaphone className="h-4 w-4" />
                      ) : selectedContact.role === "admin" ? (
                        <ShieldCheck className="h-4 w-4" />
                      ) : (
                        selectedContact.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{selectedContact.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{selectedContact.subtitle}</p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                    {threadLoading ? (
                      <div className="flex justify-center py-8"><LoadingSpinner /></div>
                    ) : messages.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">No messages yet. Say hello!</p>
                    ) : (
                      messages.map((m, i) => {
                        const isMine = m.sender_id === user?.id;
                        const showDate = i === 0 || dayLabel(m.created_at) !== dayLabel(messages[i - 1].created_at);
                        return (
                          <div key={m.id}>
                            {showDate && (
                              <div className="text-center text-[11px] text-slate-400 my-2">{dayLabel(m.created_at)}</div>
                            )}
                            <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                              <div
                                className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                                  isMine
                                    ? "bg-gradient-to-br from-purple-600 to-indigo-600 text-white rounded-br-sm"
                                    : "bg-white text-slate-800 rounded-bl-sm border border-slate-100"
                                }`}
                              >
                                {m.attachment_url && (
                                  isVoiceNote(m.attachment_name) ? (
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <Mic className={`h-3.5 w-3.5 shrink-0 ${isMine ? "text-purple-100" : "text-purple-500"}`} />
                                      <audio controls src={m.attachment_url} className="h-8 max-w-[220px]" />
                                    </div>
                                  ) : isImageFile(m.attachment_name) ? (
                                    <img src={m.attachment_url} alt={m.attachment_name || "attachment"} className="rounded-lg mb-1.5 max-h-56 object-cover" />
                                  ) : isVideoFile(m.attachment_name) ? (
                                    <video src={m.attachment_url} controls className="rounded-lg mb-1.5 max-h-56" />
                                  ) : (
                                    <a href={m.attachment_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline mb-1.5 text-xs">
                                      <FileText className="h-3.5 w-3.5" /> {m.attachment_name || "Attachment"}
                                    </a>
                                  )
                                )}
                                {m.message !== "📎 Attachment" && <p className="whitespace-pre-wrap break-words">{m.message}</p>}
                                <div className={`flex items-center gap-1 mt-1 ${isMine ? "justify-end" : "justify-start"}`}>
                                  <span className={`text-[10px] ${isMine ? "text-purple-100" : "text-slate-400"}`}>
                                    {format(new Date(m.created_at), "h:mm a")}
                                  </span>
                                  {isMine && (m.is_read ? <CheckCheck className="h-3 w-3 text-purple-100" /> : <Check className="h-3 w-3 text-purple-200" />)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {attachedFile && (
                    <div className="px-3 pt-2 shrink-0">
                      <div className="flex items-center gap-2 bg-purple-50 border border-purple-100 rounded-lg px-2.5 py-1.5 text-xs w-fit">
                        {isVoiceNote(attachedFile.name) ? (
                          <>
                            <Mic className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                            <audio controls src={URL.createObjectURL(attachedFile)} className="h-8 max-w-[220px]" />
                          </>
                        ) : isImageFile(attachedFile.name) ? (
                          <ImageIcon className="h-3.5 w-3.5 text-purple-500" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 text-purple-500" />
                        )}
                        {!isVoiceNote(attachedFile.name) && <span className="truncate max-w-[160px]">{attachedFile.name}</span>}
                        <button onClick={() => setAttachedFile(null)}><X className="h-3.5 w-3.5 text-slate-400" /></button>
                      </div>
                    </div>
                  )}

                  <div className="p-3 border-t border-slate-100 shrink-0 relative">
                    {showEmojiPicker && (
                      <div className="absolute bottom-full left-3 mb-2 bg-white border border-slate-200 rounded-xl shadow-lg p-2 grid grid-cols-6 gap-1 w-64 max-h-48 overflow-y-auto z-10">
                        {QUICK_EMOJIS.map(e => (
                          <button
                            key={e}
                            className="text-lg hover:bg-slate-100 rounded p-1"
                            onClick={() => { setMessageText(prev => prev + e); setShowEmojiPicker(false); }}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    )}
                    {isRecording && (
                      <div className="absolute bottom-full left-3 mb-2 bg-white border border-red-200 rounded-full shadow-lg px-3 py-1.5 flex items-center gap-2 text-xs text-red-600 z-10">
                        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        Recording {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")}
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={e => e.target.files?.[0] && setAttachedFile(e.target.files[0])}
                      />
                      <input
                        type="file"
                        accept="image/*,video/*"
                        ref={mediaInputRef}
                        className="hidden"
                        onChange={e => e.target.files?.[0] && setAttachedFile(e.target.files[0])}
                      />
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => fileInputRef.current?.click()}>
                        <Paperclip className="h-4.5 w-4.5 text-slate-400" />
                      </Button>
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => mediaInputRef.current?.click()}>
                        <ImageIcon className="h-4.5 w-4.5 text-slate-400" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`shrink-0 ${isRecording ? "bg-red-50" : ""}`}
                        onClick={() => (isRecording ? stopRecording() : startRecording())}
                        title={isRecording ? "Stop recording" : "Record a voice announcement"}
                      >
                        {isRecording ? <Square className="h-4 w-4 text-red-500 fill-red-500" /> : <Mic className="h-4.5 w-4.5 text-slate-400" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setShowEmojiPicker(v => !v)}>
                        <Smile className="h-4.5 w-4.5 text-slate-400" />
                      </Button>
                      <Textarea
                        value={messageText}
                        onChange={e => setMessageText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                          }
                        }}
                        placeholder="Type a message..."
                        className="resize-none min-h-[40px] max-h-28 rounded-2xl text-sm"
                        rows={1}
                      />
                      <Button
                        size="icon"
                        className="shrink-0 rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 hover:opacity-90"
                        disabled={sending || uploadingFile}
                        onClick={handleSend}
                      >
                        <Send className="h-4 w-4 text-white" />
                      </Button>
                    </div>
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
