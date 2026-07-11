// src/types/groupProjects.ts
// Shared types for the Group Projects module (Collaboration Platform)

export type GradingType = 'group' | 'individual' | 'both';
export type ProjectStatus = 'draft' | 'active' | 'closed' | 'archived';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type SubmissionStatus = 'submitted' | 'returned' | 'graded';

export interface GroupProject {
  id: string;
  class_id: string;
  teacher_id: string;
  title: string;
  description: string | null;
  subject: string | null;
  grading_type: GradingType;
  max_group_size: number;
  due_date: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  // Joined/derived fields (populated client-side, not from the table directly)
  group_count?: number;
  class_name?: string;
}

export interface ProjectGroup {
  id: string;
  group_project_id: string;
  name: string;
  created_at: string;
  members?: ProjectGroupMember[];
}

export interface ProjectGroupMember {
  id: string;
  group_id: string;
  student_id: string;
  is_leader: boolean;
  joined_at: string;
  // Joined from profiles/students table
  student_name?: string;
}

export interface ClassRosterStudent {
  student_id: string;
  full_name: string;
}

export interface ProjectGroupFile {
  id: string;
  group_id: string;
  uploaded_by: string;
  file_name: string;
  storage_path: string;
  file_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
  uploader_name?: string;
}

export interface ProjectGroupTask {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  assigned_to: string | null; // null = whole group
  status: TaskStatus;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  assignee_name?: string;
}

export interface ProjectGroupSubmission {
  id: string;
  group_id: string;
  group_project_id: string;
  submitted_by: string;
  note: string | null;
  submitted_at: string;
  status: SubmissionStatus;
}

export interface ProjectGroupGrade {
  id: string;
  submission_id: string;
  student_id: string | null; // null = whole-group grade
  score: number | null;
  max_score: number;
  feedback: string | null;
  graded_by: string;
  graded_at: string;
}