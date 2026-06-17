export type Language = "en" | "hi" | "te";

export const languages: { code: Language; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { code: "te", label: "Telugu", nativeLabel: "తెలుగు" },
];

type TranslationKeys = {
  // Navigation
  home: string;
  dashboard: string;
  settings: string;
  logout: string;
  studentReports: string;
  assessments: string;
  lessonPlanGenerator: string;
  analytics: string;
  requests: string;
  alerts: string;
  adminPanel: string;
  academicTests: string;
  gamification: string;
  aiTutor: string;
  aiKnowledgeHub: string;
  schoolIntelligence: string;
  automationWorkflows: string;
  securityCenter: string;
  billing: string;

  // Common
  save: string;
  cancel: string;
  delete: string;
  edit: string;
  create: string;
  search: string;
  loading: string;
  noData: string;
  submit: string;
  back: string;
  next: string;
  confirm: string;
  active: string;
  inactive: string;

  // Settings
  profileInformation: string;
  updateDisplayName: string;
  email: string;
  role: string;
  fullName: string;
  saveName: string;
  changePassword: string;
  updatePassword: string;
  newPassword: string;
  confirmPassword: string;
  language: string;
  selectLanguage: string;

  // Dashboard
  welcomeBack: string;
  totalStudents: string;
  totalTeachers: string;
  lessonsGenerated: string;
  atRiskStudents: string;

  // Automation
  automationRules: string;
  createRule: string;
  triggerEvent: string;
  ruleActive: string;
  executionLogs: string;
  noRulesYet: string;

  // Security
  auditLogs: string;
  securityDashboard: string;
  recentActivity: string;
  suspiciousActivity: string;
  dataExports: string;

  // Billing
  currentPlan: string;
  subscription: string;
  usage: string;
  invoices: string;
  upgradePlan: string;
};

const translations: Record<Language, TranslationKeys> = {
  en: {
    home: "Home",
    dashboard: "Dashboard",
    settings: "Settings",
    logout: "Logout",
    studentReports: "Student Reports",
    assessments: "Assessments",
    lessonPlanGenerator: "Lesson Plan Generator",
    analytics: "Analytics",
    requests: "Requests",
    alerts: "Alerts",
    adminPanel: "Admin Panel",
    academicTests: "Academic Tests",
    gamification: "Gamification",
    aiTutor: "AI Tutor",
    aiKnowledgeHub: "AI Knowledge Hub",
    schoolIntelligence: "School Intelligence",
    automationWorkflows: "Automation",
    securityCenter: "Security Center",
    billing: "Billing",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    create: "Create",
    search: "Search",
    loading: "Loading...",
    noData: "No data available",
    submit: "Submit",
    back: "Back",
    next: "Next",
    confirm: "Confirm",
    active: "Active",
    inactive: "Inactive",
    profileInformation: "Profile Information",
    updateDisplayName: "Update your display name",
    email: "Email",
    role: "Role",
    fullName: "Full Name",
    saveName: "Save Name",
    changePassword: "Change Password",
    updatePassword: "Update your account password",
    newPassword: "New Password",
    confirmPassword: "Confirm New Password",
    language: "Language",
    selectLanguage: "Select your preferred language",
    welcomeBack: "Welcome back",
    totalStudents: "Total Students",
    totalTeachers: "Total Teachers",
    lessonsGenerated: "Lessons Generated",
    atRiskStudents: "At-Risk Students",
    automationRules: "Automation Rules",
    createRule: "Create Rule",
    triggerEvent: "Trigger Event",
    ruleActive: "Active",
    executionLogs: "Execution Logs",
    noRulesYet: "No automation rules created yet",
    auditLogs: "Audit Logs",
    securityDashboard: "Security Dashboard",
    recentActivity: "Recent Activity",
    suspiciousActivity: "Suspicious Activity",
    dataExports: "Data Exports",
    currentPlan: "Current Plan",
    subscription: "Subscription",
    usage: "Usage",
    invoices: "Invoices",
    upgradePlan: "Upgrade Plan",
  },
  hi: {
    home: "होम",
    dashboard: "डैशबोर्ड",
    settings: "सेटिंग्स",
    logout: "लॉगआउट",
    studentReports: "छात्र रिपोर्ट",
    assessments: "आकलन",
    lessonPlanGenerator: "पाठ योजना जनरेटर",
    analytics: "विश्लेषण",
    requests: "अनुरोध",
    alerts: "अलर्ट",
    adminPanel: "एडमिन पैनल",
    academicTests: "शैक्षणिक परीक्षा",
    gamification: "गेमिफिकेशन",
    aiTutor: "AI ट्यूटर",
    aiKnowledgeHub: "AI ज्ञान केंद्र",
    schoolIntelligence: "स्कूल इंटेलिजेंस",
    automationWorkflows: "ऑटोमेशन",
    securityCenter: "सुरक्षा केंद्र",
    billing: "बिलिंग",
    save: "सहेजें",
    cancel: "रद्द करें",
    delete: "हटाएं",
    edit: "संपादित करें",
    create: "बनाएं",
    search: "खोजें",
    loading: "लोड हो रहा है...",
    noData: "कोई डेटा उपलब्ध नहीं",
    submit: "जमा करें",
    back: "वापस",
    next: "अगला",
    confirm: "पुष्टि करें",
    active: "सक्रिय",
    inactive: "निष्क्रिय",
    profileInformation: "प्रोफ़ाइल जानकारी",
    updateDisplayName: "अपना प्रदर्शन नाम अपडेट करें",
    email: "ईमेल",
    role: "भूमिका",
    fullName: "पूरा नाम",
    saveName: "नाम सहेजें",
    changePassword: "पासवर्ड बदलें",
    updatePassword: "अपना खाता पासवर्ड अपडेट करें",
    newPassword: "नया पासवर्ड",
    confirmPassword: "नया पासवर्ड पुष्टि करें",
    language: "भाषा",
    selectLanguage: "अपनी पसंदीदा भाषा चुनें",
    welcomeBack: "वापसी पर स्वागत",
    totalStudents: "कुल छात्र",
    totalTeachers: "कुल शिक्षक",
    lessonsGenerated: "पाठ बनाए गए",
    atRiskStudents: "जोखिम में छात्र",
    automationRules: "ऑटोमेशन नियम",
    createRule: "नियम बनाएं",
    triggerEvent: "ट्रिगर इवेंट",
    ruleActive: "सक्रिय",
    executionLogs: "निष्पादन लॉग",
    noRulesYet: "अभी तक कोई ऑटोमेशन नियम नहीं बनाया गया",
    auditLogs: "ऑडिट लॉग",
    securityDashboard: "सुरक्षा डैशबोर्ड",
    recentActivity: "हाल की गतिविधि",
    suspiciousActivity: "संदिग्ध गतिविधि",
    dataExports: "डेटा निर्यात",
    currentPlan: "वर्तमान प्लान",
    subscription: "सदस्यता",
    usage: "उपयोग",
    invoices: "चालान",
    upgradePlan: "प्लान अपग्रेड करें",
  },
  te: {
    home: "హోమ్",
    dashboard: "డాష్‌బోర్డ్",
    settings: "సెట్టింగ్‌లు",
    logout: "లాగ్‌అవుట్",
    studentReports: "విద్యార్థి నివేదికలు",
    assessments: "అంచనాలు",
    lessonPlanGenerator: "పాఠ్య ప్రణాళిక జనరేటర్",
    analytics: "విశ్లేషణలు",
    requests: "అభ్యర్థనలు",
    alerts: "అలర్ట్‌లు",
    adminPanel: "అడ్మిన్ ప్యానెల్",
    academicTests: "విద్యా పరీక్షలు",
    gamification: "గేమిఫికేషన్",
    aiTutor: "AI ట్యూటర్",
    aiKnowledgeHub: "AI జ్ఞాన కేంద్రం",
    schoolIntelligence: "పాఠశాల ఇంటెలిజెన్స్",
    automationWorkflows: "ఆటోమేషన్",
    securityCenter: "భద్రతా కేంద్రం",
    billing: "బిల్లింగ్",
    save: "సేవ్ చేయండి",
    cancel: "రద్దు చేయండి",
    delete: "తొలగించండి",
    edit: "సవరించండి",
    create: "సృష్టించండి",
    search: "వెతకండి",
    loading: "లోడ్ అవుతోంది...",
    noData: "డేటా అందుబాటులో లేదు",
    submit: "సబ్మిట్ చేయండి",
    back: "వెనుకకు",
    next: "తర్వాత",
    confirm: "నిర్ధారించండి",
    active: "యాక్టివ్",
    inactive: "ఇన్‌యాక్టివ్",
    profileInformation: "ప్రొఫైల్ సమాచారం",
    updateDisplayName: "మీ ప్రదర్శన పేరును నవీకరించండి",
    email: "ఈమెయిల్",
    role: "పాత్ర",
    fullName: "పూర్తి పేరు",
    saveName: "పేరు సేవ్ చేయండి",
    changePassword: "పాస్‌వర్డ్ మార్చండి",
    updatePassword: "మీ ఖాతా పాస్‌వర్డ్‌ను నవీకరించండి",
    newPassword: "కొత్త పాస్‌వర్డ్",
    confirmPassword: "కొత్త పాస్‌వర్డ్ నిర్ధారించండి",
    language: "భాష",
    selectLanguage: "మీ ఇష్టమైన భాషను ఎంచుకోండి",
    welcomeBack: "తిరిగి స్వాగతం",
    totalStudents: "మొత్తం విద్యార్థులు",
    totalTeachers: "మొత్తం ఉపాధ్యాయులు",
    lessonsGenerated: "రూపొందించిన పాఠాలు",
    atRiskStudents: "ప్రమాదంలో ఉన్న విద్యార్థులు",
    automationRules: "ఆటోమేషన్ నియమాలు",
    createRule: "నియమాన్ని సృష్టించండి",
    triggerEvent: "ట్రిగ్గర్ ఈవెంట్",
    ruleActive: "యాక్టివ్",
    executionLogs: "అమలు లాగ్‌లు",
    noRulesYet: "ఇంకా ఆటోమేషన్ నియమాలు సృష్టించబడలేదు",
    auditLogs: "ఆడిట్ లాగ్‌లు",
    securityDashboard: "భద్రతా డాష్‌బోర్డ్",
    recentActivity: "ఇటీవలి కార్యాచరణ",
    suspiciousActivity: "అనుమానాస్పద కార్యాచరణ",
    dataExports: "డేటా ఎక్స్‌పోర్ట్‌లు",
    currentPlan: "ప్రస్తుత ప్లాన్",
    subscription: "సభ్యత్వం",
    usage: "వినియోగం",
    invoices: "ఇన్‌వాయిస్‌లు",
    upgradePlan: "ప్లాన్ అప్‌గ్రేడ్ చేయండి",
  },
};

export default translations;
