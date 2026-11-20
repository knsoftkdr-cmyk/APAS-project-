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
};

/** Components under these folders are layout/UI kit, not features: never followed when reading a screen. */
export const SKIP_IMPORT_PREFIXES = ["@/components/ui/", "@/components/layout/", "@/hooks/", "@/lib/", "@/integrations/", "@/contexts/", "@/types/", "@/i18n/"];

export const MAX_FILES_PER_FEATURE = 10;
export const FOLLOW_DEPTH = 2;
