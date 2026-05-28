import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { TeacherRequestForm } from "@/components/TeacherRequestForm";

const Requests = () => {
  return (
    <AppLayout>
      <PageHeader
        title="Diagnostic Requests"
        subtitle="Request and track diagnostic questionnaires for your classes"
      />
      <TeacherRequestForm />
    </AppLayout>
  );
};

export default Requests;
