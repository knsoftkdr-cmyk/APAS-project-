import { Language } from "./translations";

/**
 * Sidebar and bottom-nav labels, keyed by the English label that AppSidebar's
 * nav table already uses as its `title`.
 *
 * Kept separate from translations.ts on purpose:
 *  - these are looked up by their English string, not by a typed key, so the
 *    nav table needs no `titleKey` column and no churn when items are added;
 *  - a language may cover only part of the menu. Anything missing falls back
 *    to the English label, so a half-translated language still renders a
 *    usable menu instead of blanks.
 *
 * Hindi and Telugu are intentionally absent for now — they fall back to
 * English, which is exactly what the sidebar showed before this file existed.
 */
const navLabels: Partial<Record<Language, Record<string, string>>> = {
  ar: {
    "Academic Calendar": "التقويم الأكاديمي",
    "Academic Tests": "الاختبارات الأكاديمية",
    "Adaptive Homework": "الواجبات التكيّفية",
    "Adaptive Test": "الاختبار التكيّفي",
    "Admin Panel": "لوحة الإدارة",
    "Admissions": "القبول والتسجيل",
    "AI Career Coach": "مرشد المسار المهني",
    "AI Cost Monitor": "مراقبة تكاليف الذكاء الاصطناعي",
    "AI Quality & Safety": "جودة وسلامة الذكاء الاصطناعي",
    "AI Tutor": "المدرّس الذكي",
    "Alerts": "التنبيهات",
    "Alumni": "الخريجون",
    "Analytics": "التحليلات",
    "Appointments": "المواعيد",
    "Assessment Builder": "منشئ التقييمات",
    "Assessment Evaluation": "تصحيح التقييمات",
    "Assessments": "التقييمات",
    "At-Risk Students": "الطلاب المعرضون للخطر",
    "Attendance": "الحضور",
    "Automations": "الأتمتة",
    "Behaviour": "السلوك",
    "Billing": "الفوترة",
    "BKT Calibration": "معايرة BKT",
    "Branch Management": "إدارة الفروع",
    "Cache Management": "إدارة الذاكرة المؤقتة",
    "Class Mastery": "إتقان الصف",
    "Class Velocity": "وتيرة الصف",
    "Communication": "التواصل",
    "Competency Assessment": "تقييم الكفايات",
    "Competency Definitions": "تعريفات الكفايات",
    "Competency Heatmap": "الخريطة الحرارية للكفايات",
    "Concept Dependencies": "ترابط المفاهيم",
    "Courses": "المقررات",
    "Credentials": "بيانات الاعتماد",
    "Daily Review": "المراجعة اليومية",
    "Dashboard": "لوحة التحكم",
    "Differentiation Studio": "استوديو التمايز",
    "Early Warning": "الإنذار المبكر",
    "Electives": "المواد الاختيارية",
    "Enrichment": "الإثراء",
    "Entry Ticket": "تذكرة الدخول",
    "Exam Reviews": "مراجعات الاختبارات",
    "Exam Seating": "توزيع مقاعد الاختبار",
    "Forgetting Forecast": "توقّع النسيان",
    "Gamification": "التلعيب",
    "Group Projects": "المشاريع الجماعية",
    "Hall Tickets": "بطاقات دخول القاعة",
    "Home": "الرئيسية",
    "Homework": "الواجبات",
    "Houses": "البيوت",
    "ID Cards": "البطاقات التعريفية",
    "Intervention Board": "لوحة التدخلات",
    "Invigilation": "المراقبة",
    "Item Bank & Mock Exams": "بنك الأسئلة والاختبارات التجريبية",
    "Knowledge Graph": "خريطة المعرفة",
    "Leaderboard": "لوحة المتصدرين",
    "Learning Path": "مسار التعلّم",
    "Lesson Plan": "خطة الدرس",
    "Lesson Plan Generator": "منشئ خطط الدروس",
    "Lifecycle Timeline": "المسار الزمني لدورة الحياة",
    "Marketplace": "المتجر",
    "Multi-Tenant": "تعدد المؤسسات",
    "My Accommodations": "تسهيلاتي",
    "My Attendance": "حضوري",
    "My Classroom": "فصلي الدراسي",
    "My Documents": "مستنداتي",
    "My Electives": "موادي الاختيارية",
    "My Exams": "اختباراتي",
    "My Learning Pace": "وتيرة تعلّمي",
    "My Mastery": "إتقاني",
    "My Ratings": "تقييماتي",
    "My SEN Students": "طلاب التربية الخاصة لديّ",
    "Notifications": "الإشعارات",
    "OCR Processing": "معالجة التعرّف الضوئي على النصوص",
    "Patterns to Watch": "أنماط للمتابعة",
    "Platform": "المنصة",
    "Platform Admin": "إدارة المنصة",
    "Predictions": "التنبؤات",
    "Pronunciation": "النطق",
    "Report Cards": "بطاقات الدرجات",
    "Reports": "التقارير",
    "Requests": "الطلبات",
    "Resource Analytics": "تحليلات الموارد",
    "Risk Predictions": "تنبؤات المخاطر",
    "Rotation Schedules": "جداول التناوب",
    "Safeguarding": "حماية الطلاب",
    "School Admin": "إدارة المدرسة",
    "School Intelligence": "ذكاء المدرسة",
    "School Quality Index": "مؤشر جودة المدرسة",
    "Security": "الأمان",
    "Security Center": "مركز الأمان",
    "Semester Engine": "محرك الفصول الدراسية",
    "Settings": "الإعدادات",
    "Special Education (SEN)": "التربية الخاصة",
    "Student Profile": "ملف الطالب",
    "Student Transfers": "تحويلات الطلاب",
    "Surveys": "الاستبيانات",
    "Syllabus Coverage": "تغطية المنهج",
    "Timetable": "الجدول الدراسي",
    "Transport": "النقل",
    "Virtual Classroom": "الفصل الافتراضي",
    "What's Next": "ما التالي",
    "Worksheet Submissions": "تسليمات أوراق العمل",
    "Worksheets": "أوراق العمل",
  },
};

/** The label in `language`, or the English label when it has no translation. */
export function navLabel(label: string, language: Language): string {
  return navLabels[language]?.[label] ?? label;
}

export default navLabels;
