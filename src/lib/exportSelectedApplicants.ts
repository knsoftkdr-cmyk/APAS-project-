import * as XLSX from "xlsx";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { supabase } from "@/integrations/supabase/client";
import { getGradeSortRank } from "@/types/admission";

interface SelectedApplicantRow {
  full_name: string;
  parent_name: string;
  parent_phone: string;
  previous_percentage: number | null;
  intake: { grade: string } | null;
}

export async function exportSelectedApplicants(schoolId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from("admission_applicants")
    .select("full_name, parent_name, parent_phone, previous_percentage, intake:admission_intakes(grade)")
    .eq("school_id", schoolId)
    .eq("status", "selected");

  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "No selected applicants to export yet." };

  const rows = (data as unknown as SelectedApplicantRow[])
    .map((a) => ({
      "Student Name": a.full_name,
      "Grade Applied For": a.intake?.grade ?? "",
      "Parent Name": a.parent_name,
      "Phone Number": a.parent_phone,
      "Previous %": a.previous_percentage ?? "",
      __gradeRank: getGradeSortRank(a.intake?.grade ?? ""),
    }))
    .sort(
      (a, b) => a.__gradeRank - b.__gradeRank || a["Student Name"].localeCompare(b["Student Name"])
    )
    .map(({ __gradeRank, ...rest }) => rest);

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 12 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Selected Applicants");

  const fileName = `selected-applicants-${new Date().toISOString().slice(0, 10)}.xlsx`;

  if (Capacitor.isNativePlatform()) {
    const base64 = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
    const written = await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: "Selected Applicants",
      url: written.uri,
      dialogTitle: "Save or share the applicants list",
    });
  } else {
    XLSX.writeFile(workbook, fileName);
  }

  return { error: null };
}