export interface TourStep {
  tourId: string;
  title: string;
  description: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    tourId: "nav-home",
    title: "Home",
    description:
      "This is your main dashboard where you can quickly see your activity, progress, and important updates.",
  },
  {
    tourId: "nav-dashboard",
    title: "Dashboard",
    description: "View your learning summary, performance trends, and overall student insights.",
  },
  {
    tourId: "nav-assessments",
    title: "Assessments",
    description: "Take assessments here to identify strengths, moderate areas, and areas that need attention.",
  },
  {
    tourId: "nav-academic-tests",
    title: "Academic Tests",
    description: "Access subject-based tests and academic evaluation modules.",
  },
  {
    tourId: "nav-gamification",
    title: "Gamification",
    description: "Earn rewards, track achievements, and stay motivated while learning.",
  },
  {
    tourId: "nav-settings",
    title: "Settings",
    description: "Manage your profile, preferences, and account settings.",
  },
];
