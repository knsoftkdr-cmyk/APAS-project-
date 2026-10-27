import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/AdaptivePracticeWidget", () => ({ AdaptivePracticeWidget: () => null }));
vi.mock("@/hooks/useStudentSubjects", () => ({ useStudentSubjects: () => ({ subjects: [], classLabel: null, loading: false }) }));
vi.mock("@/i18n/LanguageContext", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "stu-1" }, profile: { full_name: "Asha Rao" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "delete", "in"]) c[m] = () => c;
    c.single = async () => ({ data: { grade: "Class 7" }, error: null });
    c.maybeSingle = async () => ({ data: null, error: null });
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return c;
  };
  return { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "student-jwt" } } }) }, from: () => chain({ data: [], error: null }) } };
});

// Voice: same shape as the real useSpeechRecognition hook, but driven by the test instead of a microphone.
const voice = { supported: true, startedWith: "" as string, emit: (_t: string) => {} };
vi.mock("@/hooks/useSpeechRecognition", async () => {
  const React = await import("react");
  return {
    useSpeechRecognition: () => {
      const [listening, setListening] = React.useState(false);
      const [finalText, setFinalText] = React.useState("");
      const [error, setError] = React.useState<string | null>(null);
      voice.emit = (t: string) => setFinalText(t);
      return {
        supported: voice.supported, listening, interim: "", finalText, error,
        start: (lang: string) => { voice.startedWith = lang; setFinalText(""); setListening(true); },
        stop: () => setListening(false), cancel: () => setListening(false), clearError: () => setError(null),
      };
    },
  };
});

// File preparation needs a real canvas / PDF engine, so fake only that step; the real classifier and limits still run.
vi.mock("@/lib/tutorAttachments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tutorAttachments")>("@/lib/tutorAttachments");
  let n = 0;
  return {
    ...actual,
    prepareFile: vi.fn(async (file: File) => {
      const c = actual.classifyFile(file);
      if (!c.ok) return { ok: false, error: c.reason };
      const id = `t${n++}`;
      if (c.cls === "image") return { ok: true, attachments: [{ id, kind: "image", name: file.name, mime: "image/jpeg", data: "/9j/AAAA", preview: "data:image/jpeg;base64,/9j/AAAA" }] };
      return { ok: true, attachments: [{ id, kind: "document", name: file.name, mime: "text/plain", text: `TEXT OF ${file.name}`, truncated: file.name.startsWith("long"), note: "2 of 2 pages read" }] };
    }),
  };
});

import AITutor from "@/pages/AITutor";

const sse = (text: string) => new Response(
  new ReadableStream({ start(c) { const e = new TextEncoder(); c.enqueue(e.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`)); c.close(); } }),
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
let calls: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
let nextResponse: () => Response = () => sse("Here is how it works.");

const renderPage = (path = "/ai-tutor") => render(<MemoryRouter initialEntries={[path]}><AITutor /></MemoryRouter>);
const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const pick = async (testId: string, files: File[]) => { fireEvent.change(screen.getByTestId(testId), { target: { files } }); await flush(); await flush(); };
const file = (name: string, type = "") => new File(["x"], name, { type });
const send = async () => { fireEvent.click(screen.getByLabelText("Send")); await flush(); await flush(); };

beforeEach(() => {
  calls = [];
  nextResponse = () => sse("Here is how it works.");
  voice.supported = true;
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return nextResponse();
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AI Tutor - typed chat is unchanged", () => {
  it("sends plain text with the student's token, no attachments field, and shows the reply", async () => {
    renderPage();
    await flush();
    fireEvent.change(box(), { target: { value: "What is photosynthesis?" } });
    await send();
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe("Bearer student-jwt");
    expect(calls[0].body.message).toBe("What is photosynthesis?");
    expect(calls[0].body.student_id).toBe("stu-1");
    expect("attachments" in calls[0].body).toBe(false);
    expect(await screen.findByText("Here is how it works.")).toBeTruthy();
  });
  it("only sends role + content in the history (no thumbnails or extras)", async () => {
    renderPage();
    await flush();
    fireEvent.change(box(), { target: { value: "first" } });
    await send();
    fireEvent.change(box(), { target: { value: "second" } });
    await send();
    expect(calls[1].body.conversation_history).toEqual([
      { role: "user", content: "first" }, { role: "assistant", content: "Here is how it works." },
    ]);
  });
  it("Send stays disabled with nothing typed and nothing attached", async () => {
    renderPage();
    await flush();
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AI Tutor - photos (image understanding)", () => {
  it("attaches a photo, sends it with the question, and keeps it for follow-ups until removed", async () => {
    renderPage();
    await flush();
    await pick("input-photo", [file("textbook-q5.jpg", "image/jpeg")]);
    expect(screen.getByText("textbook-q5.jpg")).toBeTruthy();

    fireEvent.change(box(), { target: { value: "Solve question 5" } });
    await send();
    const first = calls[0].body as { message: string; attachments: Array<Record<string, unknown>> };
    expect(first.message).toBe("Solve question 5");
    expect(first.attachments).toEqual([{ kind: "image", name: "textbook-q5.jpg", mime: "image/jpeg", data: "/9j/AAAA" }]);
    expect(JSON.stringify(first)).not.toContain("preview"); // thumbnails never leave the browser

    // follow-up about the same photo
    fireEvent.change(box(), { target: { value: "Why is step 2 done that way?" } });
    await send();
    expect((calls[1].body.attachments as unknown[]).length).toBe(1);

    // removing it stops sending it
    fireEvent.click(screen.getByLabelText("Remove textbook-q5.jpg"));
    fireEvent.change(box(), { target: { value: "Thanks. New question: what is a noun?" } });
    await send();
    expect("attachments" in calls[2].body).toBe(false);
  });
  it("a photo alone (no typed question) can be sent and gets a default question", async () => {
    renderPage();
    await flush();
    await pick("input-camera", [file("IMG_0001.JPG", "image/jpeg")]);
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(false);
    await send();
    expect(String(calls[0].body.message)).toMatch(/attached photo/i);
  });
  it("shows the photo in the student's message bubble", async () => {
    renderPage();
    await flush();
    await pick("input-photo", [file("diagram.png", "image/png")]);
    fireEvent.change(box(), { target: { value: "Label this" } });
    await send();
    expect(document.querySelector('img[title="diagram.png"]')).toBeTruthy();
  });
  it("stops at 4 photos with a clear message", async () => {
    renderPage();
    await flush();
    await pick("input-photo", ["a", "b", "c", "d", "e"].map((n) => file(`${n}.jpg`, "image/jpeg")));
    expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(4);
    expect(screen.getByTestId("attach-error").textContent).toMatch(/up to 4 photos/);
  });
});

describe("AI Tutor - documents (file reading)", () => {
  it("attaches a PDF and sends its extracted text", async () => {
    renderPage();
    await flush();
    await pick("input-document", [file("chapter3.pdf", "application/pdf")]);
    expect(screen.getByText("2 of 2 pages read")).toBeTruthy();
    fireEvent.change(box(), { target: { value: "Summarise this chapter" } });
    await send();
    expect(calls[0].body.attachments).toEqual([{ kind: "document", name: "chapter3.pdf", mime: "text/plain", text: "TEXT OF chapter3.pdf", truncated: false }]);
  });
  it("accepts Word and text files and flags long ones", async () => {
    renderPage();
    await flush();
    await pick("input-document", [file("notes.docx"), file("long-essay.txt", "text/plain")]);
    expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(2);
    expect(screen.getByText(/using the first part/)).toBeTruthy();
  });
  it("allows at most 2 documents", async () => {
    renderPage();
    await flush();
    await pick("input-document", [file("a.pdf"), file("b.pdf"), file("c.pdf")]);
    expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(2);
    expect(screen.getByTestId("attach-error").textContent).toMatch(/up to 2 documents/);
  });
});

describe("AI Tutor - unsupported files are rejected clearly", () => {
  it.each([
    ["old.doc", /\.docx or PDF/], ["sheet.xlsx", /Spreadsheets/], ["clip.mp4", /Videos/], ["setup.exe", /can't be attached/], ["archive.zip", /Compressed/], ["track.mp3", /microphone/], ["mystery.xyz", /isn't a supported file/],
  ])("%s", async (name, msg) => {
    renderPage();
    await flush();
    await pick("input-document", [file(name)]);
    expect(screen.getByTestId("attach-error").textContent).toMatch(msg);
    expect(screen.queryByTestId("attachment-chips")).toBeNull();
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
  });
  it("rejects an oversized photo and an empty file", async () => {
    renderPage();
    await flush();
    const huge = file("huge.jpg", "image/jpeg");
    Object.defineProperty(huge, "size", { value: 40 * 1024 * 1024 });
    await pick("input-photo", [huge]);
    expect(screen.getByTestId("attach-error").textContent).toMatch(/too large/);
    await pick("input-document", [new File([], "empty.pdf")]);
    expect(screen.getByTestId("attach-error").textContent).toMatch(/empty/);
  });
  it("still attaches the good files when one in the batch is bad", async () => {
    renderPage();
    await flush();
    await pick("input-document", [file("good.pdf"), file("bad.zip")]);
    expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(1);
    expect(screen.getByTestId("attach-error").textContent).toMatch(/Compressed/);
  });
});

describe("AI Tutor - voice input", () => {
  it("fills the box from speech in the student's language and does NOT send automatically", async () => {
    renderPage();
    await flush();
    fireEvent.change(box(), { target: { value: "Explain" } });
    fireEvent.click(screen.getByTestId("voice-button"));
    expect(voice.startedWith).toBe("en-IN");
    expect(box().placeholder).toMatch(/Listening/);
    await act(async () => { voice.emit("the water cycle"); });
    expect(box().value).toBe("Explain the water cycle");
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByTestId("voice-button")); // stop
    await flush();
    expect(box().readOnly).toBe(false);
    await send();
    expect(calls[0].body.message).toBe("Explain the water cycle");
  });
  it("is disabled with an explanation where the browser has no speech recognition", async () => {
    voice.supported = false;
    renderPage();
    await flush();
    const b = screen.getByTestId("voice-button") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toMatch(/Chrome or Edge/);
  });
});

describe("AI Tutor - other behaviour preserved", () => {
  it("Career Coach mode has no attachment button (voice still works)", async () => {
    renderPage();
    await flush();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /career/i }));
    await flush();
    expect(screen.queryByLabelText("Attach a photo or document")).toBeNull();
    expect(screen.getByTestId("voice-button")).toBeTruthy();
  });
  it("shows the server's clear message when an attachment is refused", async () => {
    nextResponse = () => new Response(JSON.stringify({ error: "\"x.jpg\" is not a supported image. Please use a JPG, PNG or WebP photo." }), { status: 415, headers: { "Content-Type": "application/json" } });
    renderPage();
    await flush();
    await pick("input-photo", [file("x.jpg", "image/jpeg")]);
    await send();
    await waitFor(() => expect(screen.getByText(/not a supported image/)).toBeTruthy());
  });
});
