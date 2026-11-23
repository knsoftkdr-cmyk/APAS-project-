// tools/feature-docs/config.mjs
// What the generator builds. Add a role here to produce a knowledge base for another assistant (parent, teacher).

export const ROLE_CONFIGS = {
  student: {
    role: "student",
    /** Hand-written guide module: exports the curated entries and the menu-row helper. */
    guide: "supabase/functions/_shared/studentFeatureGuide.ts",
    guideExport: "STUDENT_FEATURES",
    menuRowsExport: "studentMenuRows",
    /** The profile tab strip (value/label/hint) to read tabs from. */
    profileTabsFile: "src/components/student/Student360Profile.tsx",
    out: "docs/feature-kb/student",
  },

  // Role-specific feature awareness for the other assistants. Each role gets its OWN knowledge base (own file, own
  // rows in app_feature_docs): the pages come from that role's sidebar rows, the screens from the routes that role may
  // open, and the written text from that role's guide. No profile tab strip: only students and parents have one.
  teacher: {
    role: "teacher",
    guide: "supabase/functions/_shared/teacherFeatureGuide.ts",
    guideExport: "TEACHER_FEATURES",
    menuRowsExport: "teacherMenuRows",
    profileTabsFile: null,
    isolateSharedScreens: true, // a page several roles can open is described for this role only from role-scoped sources
    out: "docs/feature-kb/teacher",
  },
  hod: {
    role: "hod",
    guide: "supabase/functions/_shared/hodFeatureGuide.ts",
    guideExport: "HOD_FEATURES",
    menuRowsExport: "hodMenuRows",
    profileTabsFile: null,
    isolateSharedScreens: true, // a page several roles can open is described for this role only from role-scoped sources
    out: "docs/feature-kb/hod",
  },
  principal: {
    role: "principal",
    guide: "supabase/functions/_shared/principalFeatureGuide.ts",
    guideExport: "PRINCIPAL_FEATURES",
    menuRowsExport: "principalMenuRows",
    profileTabsFile: null,
    isolateSharedScreens: true, // a page several roles can open is described for this role only from role-scoped sources
    out: "docs/feature-kb/principal",
  },
  school_admin: {
    role: "school_admin",
    guide: "supabase/functions/_shared/schoolAdminFeatureGuide.ts",
    guideExport: "SCHOOL_ADMIN_FEATURES",
    menuRowsExport: "schoolAdminMenuRows",
    profileTabsFile: null,
    isolateSharedScreens: true, // a page several roles can open is described for this role only from role-scoped sources
    out: "docs/feature-kb/school_admin",
  },
  // The parent already has a hand-written guide (parentFeatureGuide.ts); this only adds the generated knowledge base.
  parent: {
    role: "parent",
    guide: "supabase/functions/_shared/parentFeatureGuide.ts",
    guideExport: "PARENT_FEATURES",
    menuRowsExport: "parentMenuRows",
    profileTabsFile: "src/components/student/Student360Profile.tsx",
    isolateSharedScreens: true,
    out: "docs/feature-kb/parent",
  },
};

/**
 * Hand-written entries that are NOT a menu page or profile tab (cards, header tools). They have no route, so the
 * generator cannot find their source on its own. Listing the files that implement them lets it notice when the
 * screen changes and flag the written text for review. Keys are the entry ids in the guide.
 */
export const MANUAL_FEATURE_SOURCES = {
  "engagement-score": ["src/components/engagement/StudentEngagementCard.tsx", "src/components/engagement/StudentEngagementDialog.tsx"],
  "ask-apas": ["src/components/command-bar/CommandBar.tsx"],
  "global-search": ["src/components/search/UniversalSearch.tsx"],
  "study-buddy": ["src/components/ai-assistant/AIStudentAssistantWidget.tsx"],
  // header tools shared with the staff roles (their guides use the same ids)
  "help-menu": ["src/components/help/HelpMenu.tsx"],
};

/** Components under these folders are layout/UI kit, not features: never followed when reading a screen. */
export const SKIP_IMPORT_PREFIXES = ["@/components/ui/", "@/components/layout/", "@/hooks/", "@/lib/", "@/integrations/", "@/contexts/", "@/types/", "@/i18n/"];

export const MAX_FILES_PER_FEATURE = 10;
export const FOLLOW_DEPTH = 2;
