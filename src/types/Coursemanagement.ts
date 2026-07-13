export type CourseStatus = 'draft' | 'published' | 'archived';
export type ProgressStatus = 'locked' | 'available' | 'in_progress' | 'completed';
export type CredentialCriteriaType = 'course_completion' | 'path_completion' | 'score_threshold';
export type TopicType = 'learn' | 'practice';

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
  created_at: string;
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