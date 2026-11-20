export type CourseStatus = 'draft' | 'published' | 'archived';
export type ProgressStatus = 'locked' | 'available' | 'in_progress' | 'completed';
export type CredentialCriteriaType = 'course_completion' | 'path_completion' | 'score_threshold';
export type TopicType = 'learn' | 'practice';
export type ContentStatus =
  | 'draft' | 'pending_review' | 'changes_requested' | 'rejected' | 'approved' | 'published' | 'archived';
export type LearningPathMode = 'flexible' | 'sequential';
export type MaterialType = 'pdf' | 'ppt' | 'document' | 'video' | 'image' | 'notes' | 'link';
export type TopicState = 'locked' | 'available' | 'in_progress' | 'completed';
export type AssessmentLinkType = 'homework' | 'worksheet' | 'assessment';

export interface Course {
  id: string;
  school_id: string;
  title: string;
  description: string | null;
  subject: string | null;
  class_level: string | null;
  thumbnail_url: string | null;
  status: CourseStatus;
  mentor_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  academic_year_id?: string | null;   // Academic Session
  semester_id?: string | null;        // Semester / term
  learning_path_mode?: LearningPathMode;
  mentor?: { id: string; full_name: string | null } | null; // populated via join
}

export interface CourseModule {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  content_url: string | null;      // optional module-level attachment
  content_body: string | null;     // optional module-level overview text
  vark_type: string | null;
  order_index: number;
  status?: ContentStatus;          // missing on old rows => treated as published
  created_at: string;
}

export interface CourseChapter {
  id: string;
  module_id: string;
  title: string;
  description: string | null;
  order_index: number;
  status: ContentStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseTopic {
  id: string;
  module_id: string;
  title: string;
  topic_type: TopicType;
  content_body: string | null;     // main lesson content, rich text/HTML
  content_url: string | null;      // optional attachment
  order_index: number;
  created_at: string;
  chapter_id?: string | null;      // null => topic sits directly under the module (legacy shape)
  description?: string | null;
  learning_objectives?: string | null;
  estimated_minutes?: number | null;
  status?: ContentStatus;
  updated_at?: string;
}

export interface TopicMaterial {
  id: string;
  topic_id: string;
  title: string;
  material_type: MaterialType;
  file_url: string | null;
  storage_path: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  content_body: string | null;
  order_index: number;
  status: ContentStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopicPrerequisite {
  id: string;
  topic_id: string;
  prerequisite_topic_id: string;
}

export interface TopicAssessmentLink {
  id: string;
  topic_id: string;
  link_type: AssessmentLinkType;
  ref_id: string;
  title: string | null;
  due_date: string | null;
}

export interface LearningPath {
  id: string;
  school_id: string;
  title: string;
  description: string | null;
  class_level: string | null;
  created_by: string | null;
  created_at: string;
}

export interface LearningPathCourse {
  id: string;
  path_id: string;
  course_id: string;
  order_index: number;
  is_required: boolean;
  course?: Course; // populated via join
}

export interface CoursePrerequisite {
  id: string;
  course_id: string;
  prerequisite_course_id: string;
  min_score: number | null;
}

export interface StudentCourseProgress {
  id: string;
  student_id: string;
  course_id: string;
  status: ProgressStatus;
  progress_percent: number;
  score: number | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface StudentTopicProgress {
  id: string;
  student_id: string;
  topic_id: string;
  completed: boolean;
  completed_at: string | null;
  time_spent_seconds?: number;
  started_at?: string | null;
  last_accessed_at?: string | null;
}

export interface StudentModuleProgress {
  id: string;
  student_id: string;
  module_id: string;
  completed: boolean;
  completed_at: string | null;
}

// ---- Shapes returned by the get_student_course_structure / get_student_topic RPCs ----
export interface StructureTopic {
  id: string;
  module_id: string;
  chapter_id: string | null;
  title: string;
  topic_type: TopicType;
  description: string | null;
  estimated_minutes: number | null;
  order_index: number;
  seq: number;
  state: TopicState;
  locked_reason: string | null;
  missing_prerequisites: { id: string; title: string }[];
  materials_count: number;
  time_spent_seconds: number;
  last_accessed_at: string | null;
}
export interface StructureChapter {
  id: string;
  module_id: string;
  title: string;
  description: string | null;
  order_index: number;
  total_topics: number;
  completed_topics: number;
  percent: number;
  topics: StructureTopic[];
}
export interface StructureModule {
  id: string;
  title: string;
  description: string | null;
  order_index: number;
  content_body: string | null;
  content_url: string | null;
  chapters: StructureChapter[];
  loose_topics: StructureTopic[];
  total_topics: number;
  completed_topics: number;
  percent: number;
}
export interface CourseStructure {
  course: {
    id: string; title: string; description: string | null; subject: string | null; class_level: string | null;
    learning_path_mode: LearningPathMode; academic_year_id: string | null; semester_id: string | null;
  };
  modules: StructureModule[];
  total_topics: number;
  completed_topics: number;
  next_topic_id: string | null;
  last_topic_id: string | null;
}
export interface StudentTopicView {
  locked: boolean;
  course_id: string;
  topic: {
    id: string; title: string; topic_type?: TopicType; description?: string | null; learning_objectives?: string | null;
    content_body?: string | null; content_url?: string | null; estimated_minutes?: number | null;
    module_id?: string; chapter_id?: string | null;
  };
  missing_prerequisites?: { id: string; title: string }[];
  completed?: boolean;
  time_spent_seconds?: number;
  next_topic_id?: string | null;
  materials?: {
    id: string; title: string; material_type: MaterialType; file_url: string | null; storage_path: string | null;
    file_name: string | null; content_body: string | null; completed: boolean; progress_percent: number;
  }[];
  linked_work?: { id: string; link_type: AssessmentLinkType; ref_id: string; title: string | null; due_date: string | null }[];
}
export interface CourseCompletionStats {
  learners: number;
  topics: { topic_id: string; title: string; completed: number; started: number; avg_seconds: number }[];
  students: { student_id: string; name: string | null; percent: number; status: string | null; time_spent_seconds: number; last_active: string | null }[];
}

export interface MicroCredential {
  id: string;
  school_id: string;
  title: string;
  description: string | null;
  badge_icon_url: string | null;
  criteria_type: CredentialCriteriaType;
  criteria_course_id: string | null;
  criteria_path_id: string | null;
  min_score: number | null;
}

export interface StudentCredential {
  id: string;
  student_id: string;
  credential_id: string;
  awarded_at: string;
  credential?: MicroCredential; // populated via join
}

// Convenience shape for catalog rendering
export interface CourseWithProgress extends Course {
  progress?: StudentCourseProgress;
  moduleCount?: number;
  topicCount?: number;
  isLocked?: boolean;
  prerequisiteTitles?: string[];
}