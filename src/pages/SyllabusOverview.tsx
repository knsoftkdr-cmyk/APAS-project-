import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import SchoolSyllabusOverview from "@/components/SchoolSyllabusOverview";

export default function SyllabusOverview() {
  return (
    <AppLayout>
      <PageHeader
        title="Syllabus Coverage"
        description="Track how much of the syllabus each teacher has covered, by class and subject."
      />
      <div className="mt-6">
        <SchoolSyllabusOverview />
      </div>
    </AppLayout>
  );
}
