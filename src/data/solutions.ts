import {
  Wallet,
  Receipt,
  GraduationCap,
  UserPlus,
  Building2,
  type LucideIcon,
} from "lucide-react";

export interface SolutionFeature {
  icon: LucideIcon;
  title: string;
  desc: string;
}

export interface SolutionStat {
  label: string;
  value: string;
}

export interface Solution {
  slug: string;
  title: string;
  cardDesc: string;
  heroSubtitle: string;
  icon: LucideIcon;
  colorFrom: string;
  colorTo: string;
  iconBg: string;
  badge: string;
  overview: string;
  features: SolutionFeature[];
  stats: SolutionStat[];
}

export const solutions: Solution[] = [
  {
    slug: "finance-erp",
    title: "Finance ERP",
    cardDesc: "Unified accounting, budgeting, and financial reporting for your institution.",
    heroSubtitle:
      "Simplify your institution's financial operations with an intelligent ERP system.",
    icon: Wallet,
    colorFrom: "from-blue-500",
    colorTo: "to-indigo-600",
    iconBg: "bg-gradient-to-br from-blue-500 to-indigo-600",
    badge: "AI-Powered Education ERP",
    overview:
      "APAS Finance ERP brings every ledger, budget, and expense under one intelligent roof. Finance teams get real-time visibility into cash flow, automated reconciliations, and audit-ready reports, while leadership gets forecasts they can actually trust.",
    features: [
      {
        icon: Wallet,
        title: "General Ledger & Accounting",
        desc: "Multi-branch chart of accounts with automated journal entries and reconciliation.",
      },
      {
        icon: Receipt,
        title: "Budgeting & Forecasting",
        desc: "AI-assisted budget planning with variance tracking against real spend.",
      },
      {
        icon: Building2,
        title: "Vendor & Expense Management",
        desc: "Purchase orders, approvals, and vendor payments in a single workflow.",
      },
      {
        icon: GraduationCap,
        title: "Compliance & Audit Trails",
        desc: "Full audit history and statutory reports ready for regulators and boards.",
      },
    ],
    stats: [
      { label: "Faster monthly close", value: "3x" },
      { label: "Reduction in reconciliation errors", value: "92%" },
      { label: "Real-time financial dashboards", value: "24/7" },
    ],
  },
  {
    slug: "fee-management",
    title: "Fee Management",
    cardDesc: "Automated fee collection, invoicing, and reminders for parents and staff.",
    heroSubtitle:
      "Automate fee collection and give parents a seamless, transparent payment experience.",
    icon: Receipt,
    colorFrom: "from-emerald-500",
    colorTo: "to-green-600",
    iconBg: "bg-gradient-to-br from-emerald-500 to-green-600",
    badge: "AI-Powered Education ERP",
    overview:
      "APAS Fee Management removes the back-and-forth from fee collection. Structure fee plans by class or student, send automated reminders, accept online payments, and reconcile every transaction without spreadsheets.",
    features: [
      {
        icon: Receipt,
        title: "Flexible Fee Structures",
        desc: "Class-wise, term-wise, or student-specific fee plans with discounts and scholarships.",
      },
      {
        icon: Wallet,
        title: "Online Payments",
        desc: "Card, UPI, and bank transfer collection with instant digital receipts.",
      },
      {
        icon: UserPlus,
        title: "Automated Reminders",
        desc: "Smart nudges to parents before and after due dates, across SMS and email.",
      },
      {
        icon: Building2,
        title: "Real-Time Reconciliation",
        desc: "Every payment auto-synced with Finance ERP for a single source of truth.",
      },
    ],
    stats: [
      { label: "Faster fee collection", value: "2.5x" },
      { label: "Drop in overdue payments", value: "68%" },
      { label: "Parent payment satisfaction", value: "96%" },
    ],
  },
];

export const getSolutionBySlug = (slug: string) =>
  solutions.find((s) => s.slug === slug);
