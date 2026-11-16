// Messages that come back from the database functions and edge functions (errors, blocked reasons) arrive as English
// text at runtime, so the i18n build step can't see them. Each one is listed here once: `en` is exactly what the server
// sends ({0}, {1} stand for the parts that vary) and `label` is what the user sees, which the i18n step translates.
//
// Built inside a function so the labels are read in the active language, not when this module first loads.

// {n} goes through p() so the i18n step sees a sentence with a slot, not a literal brace.
const p = (i: number) => `{${i}}`;

const messages = () => [
  // Admission enquiry form (public, parents)
  { en: "This enquiry link is not valid.", label: "This enquiry link is not valid." },
  { en: "Please enter the student's name.", label: "Please enter the student's name." },
  { en: "Please enter the parent's name.", label: "Please enter the parent's name." },
  { en: "Please enter a valid phone number.", label: "Please enter a valid phone number." },
  { en: "Please enter a valid email address.", label: "Please enter a valid email address." },
  { en: "Your message is too long.", label: "Your message is too long." },
  { en: "Too many enquiries right now. Please try again later.", label: "Too many enquiries right now. Please try again later." },
  // Doubts
  { en: "Only students can ask doubts.", label: "Only students can ask doubts." },
  { en: "Your profile has no school.", label: "Your profile has no school." },
  { en: "Please type your doubt.", label: "Please type your doubt." },
  { en: "Please choose a subject.", label: "Please choose a subject." },
  { en: "That teacher is not at your school.", label: "That teacher is not at your school." },
  { en: "Doubt not found.", label: "Doubt not found." },
  { en: "You cannot reply to this doubt.", label: "You cannot reply to this doubt." },
  { en: "Please type a reply.", label: "Please type a reply." },
  { en: "You cannot change this doubt.", label: "You cannot change this doubt." },
  { en: "You cannot change this doubt to that status.", label: "You cannot change this doubt to that status." },
  { en: "Unknown status.", label: "Unknown status." },
  // Certificates
  { en: "Template not found.", label: "Template not found." },
  { en: "This template is archived.", label: "This template is archived." },
  { en: "Select at least one student.", label: "Select at least one student." },
  { en: "Please issue at most 2000 certificates at a time.", label: "Please issue at most 2000 certificates at a time." },
  { en: "Certificate not found.", label: "Certificate not found." },
  { en: "Please give a reason.", label: "Please give a reason." },
  { en: "Not enrolled in the course", label: "Not enrolled in the course" },
  { en: "Course not completed", label: "Course not completed" },
  { en: "No course score yet", label: "No course score yet" },
  { en: "Not a student of this school", label: "Not a student of this school" },
  { en: "Scored {0}, needs {1}", label: `Scored ${p(0)}, needs ${p(1)}` },
  // Zoom (ai-teacher-assistant)
  { en: "Zoom isn't connected for this school yet.", label: "Zoom isn't connected for this school yet." },
  { en: "Zoom rejected the school's credentials. Please check the Zoom app settings.", label: "Zoom rejected the school's credentials. Please check the Zoom app settings." },
  { en: "Zoom couldn't create the meeting. Please try again, or paste a link instead.", label: "Zoom couldn't create the meeting. Please try again, or paste a link instead." },
  { en: "Please set a valid start and end time first.", label: "Please set a valid start and end time first." },
  { en: "Only teachers can manage class meetings", label: "Only teachers can manage class meetings" },
  { en: "Class not found", label: "Class not found" },
  { en: "This class wasn't created through Zoom here.", label: "This class wasn't created through Zoom here." },
  { en: "Zoom couldn't find this meeting. It may have been deleted.", label: "Zoom couldn't find this meeting. It may have been deleted." },
  // Questions from a document (generate-item-bank)
  { en: "Choose a chapter first", label: "Choose a chapter first" },
  { en: "Chapter not found", label: "Chapter not found" },
  { en: "The document has too little text to write questions from", label: "The document has too little text to write questions from" },
  { en: "That part of the document is too long", label: "That part of the document is too long" },
  { en: "This chapter has no learning objectives yet. Pick a topic above and use Create learning objectives first.", label: "This chapter has no learning objectives yet. Pick a topic above and use Create learning objectives first." },
  { en: "The AI reply couldn't be read. Please try again.", label: "The AI reply couldn't be read. Please try again." },
  { en: "Not permitted to author questions", label: "Not permitted to author questions" },
  // Reading a document in the browser (documentText.ts)
  { en: "\"{0}\" is password-protected. Please remove the password and try again.", label: `"${p(0)}" is password-protected. Please remove the password and try again.` },
  { en: "\"{0}\" couldn't be read. The PDF may be damaged.", label: `"${p(0)}" couldn't be read. The PDF may be damaged.` },
  { en: "\"{0}\" looks like a scanned PDF with no readable text. Please upload a PDF with selectable text, or a Word file.", label: `"${p(0)}" looks like a scanned PDF with no readable text. Please upload a PDF with selectable text, or a Word file.` },
  { en: "\"{0}\" couldn't be read. Please check it's a valid .docx file.", label: `"${p(0)}" couldn't be read. Please check it's a valid .docx file.` },
  { en: "\"{0}\" couldn't be read. Please check it's a valid .pptx file.", label: `"${p(0)}" couldn't be read. Please check it's a valid .pptx file.` },
  { en: "\"{0}\" doesn't look like a text file.", label: `"${p(0)}" doesn't look like a text file.` },
  { en: "\"{0}\": Old Word files (.doc) can't be read. Please save it as .docx or PDF.", label: `"${p(0)}": Old Word files (.doc) can't be read. Please save it as .docx or PDF.` },
  { en: "\"{0}\": Old PowerPoint files (.ppt) can't be read. Please save it as .pptx or PDF.", label: `"${p(0)}": Old PowerPoint files (.ppt) can't be read. Please save it as .pptx or PDF.` },
  { en: "\"{0}\" is empty.", label: `"${p(0)}" is empty.` },
  { en: "\"{0}\" is too large. Documents can be up to {1} MB.", label: `"${p(0)}" is too large. Documents can be up to ${p(1)} MB.` },
  { en: "\"{0}\" isn't supported. Please upload a PDF, Word (.docx), PowerPoint (.pptx) or text file.", label: `"${p(0)}" isn't supported. Please upload a PDF, Word (.docx), PowerPoint (.pptx) or text file.` },
  { en: "\"{0}\" has too little text to write questions from.", label: `"${p(0)}" has too little text to write questions from.` },
  // Class links (videoProviders.ts) and certificate drawing (certificates.ts)
  { en: "Please add the class link.", label: "Please add the class link." },
  { en: "RTMP is a streaming address, students can't open it. Paste the viewer link instead, such as the YouTube Live watch link.", label: "RTMP is a streaming address, students can't open it. Paste the viewer link instead, such as the YouTube Live watch link." },
  { en: "The class link must start with https://", label: "The class link must start with https://" },
  { en: "Online class", label: "Online class" },
  { en: "The certificate background image couldn't be loaded.", label: "The certificate background image couldn't be loaded." },
  { en: "This browser can't draw certificates.", label: "This browser can't draw certificates." },
  // Durations on the doubts page (doubts.ts formatDuration)
  { en: "{0} min", label: `${p(0)} min` },
  { en: "{0} hrs", label: `${p(0)} hrs` },
  { en: "{0} days", label: `${p(0)} days` },
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The user's-language version of a message from the server; anything not listed is shown unchanged. */
export function localizeServerMessage(message: string | null | undefined): string {
  const text = (message ?? "").trim();
  if (!text) return "";
  for (const m of messages()) {
    if (!m.en.includes("{")) {
      if (m.en === text) return m.label;
      continue;
    }
    const pattern = new RegExp(`^${m.en.split(/\{\d\}/).map(escapeRegExp).join("(.+?)")}$`);
    const match = text.match(pattern);
    if (match) return m.label.replace(/\{(\d)\}/g, (_, i: string) => match[Number(i) + 1] ?? "");
  }
  return message ?? "";
}
