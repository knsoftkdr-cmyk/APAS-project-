export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      academic_tests: {
        Row: {
          answers: Json
          completed_at: string
          id: string
          questions: Json
          score: number
          section: string | null
          student_class: string
          student_id: string
          subject: string
          total_questions: number
        }
        Insert: {
          answers?: Json
          completed_at?: string
          id?: string
          questions?: Json
          score?: number
          section?: string | null
          student_class: string
          student_id: string
          subject: string
          total_questions?: number
        }
        Update: {
          answers?: Json
          completed_at?: string
          id?: string
          questions?: Json
          score?: number
          section?: string | null
          student_class?: string
          student_id?: string
          subject?: string
          total_questions?: number
        }
        Relationships: []
      }
      achievement_definitions: {
        Row: {
          category: string
          created_at: string
          description: string
          icon: string
          id: string
          key: string
          threshold: number
          title: string
          xp_reward: number
        }
        Insert: {
          category?: string
          created_at?: string
          description: string
          icon?: string
          id?: string
          key: string
          threshold?: number
          title: string
          xp_reward?: number
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          key?: string
          threshold?: number
          title?: string
          xp_reward?: number
        }
        Relationships: []
      }
      ai_embeddings: {
        Row: {
          content: string
          created_at: string
          embedding: string
          id: string
          metadata: Json | null
          source_type: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding: string
          id?: string
          metadata?: Json | null
          source_type?: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string
          id?: string
          metadata?: Json | null
          source_type?: string
        }
        Relationships: []
      }
      ai_hook_violations: {
        Row: {
          action_taken: string
          caller_id: string | null
          created_at: string
          details: Json
          hook_key: string
          id: string
          severity: string
          skill_key: string | null
          stage: string
        }
        Insert: {
          action_taken: string
          caller_id?: string | null
          created_at?: string
          details?: Json
          hook_key: string
          id?: string
          severity: string
          skill_key?: string | null
          stage: string
        }
        Update: {
          action_taken?: string
          caller_id?: string | null
          created_at?: string
          details?: Json
          hook_key?: string
          id?: string
          severity?: string
          skill_key?: string | null
          stage?: string
        }
        Relationships: []
      }
      ai_hooks: {
        Row: {
          action_on_fail: string
          applies_to: string[]
          category: string
          config: Json
          created_at: string
          description: string | null
          hook_key: string
          id: string
          is_active: boolean
          name: string
          severity: string
          stage: string
          updated_at: string
        }
        Insert: {
          action_on_fail?: string
          applies_to?: string[]
          category: string
          config?: Json
          created_at?: string
          description?: string | null
          hook_key: string
          id?: string
          is_active?: boolean
          name: string
          severity?: string
          stage: string
          updated_at?: string
        }
        Update: {
          action_on_fail?: string
          applies_to?: string[]
          category?: string
          config?: Json
          created_at?: string
          description?: string | null
          hook_key?: string
          id?: string
          is_active?: boolean
          name?: string
          severity?: string
          stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_memory: {
        Row: {
          class_level: string | null
          created_at: string
          expires_at: string | null
          id: string
          importance: number
          key: string
          memory_type: string
          owner_id: string
          scope: string
          source: string | null
          subject: string | null
          summary: string | null
          updated_at: string
          value: Json
        }
        Insert: {
          class_level?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          importance?: number
          key: string
          memory_type: string
          owner_id: string
          scope?: string
          source?: string | null
          subject?: string | null
          summary?: string | null
          updated_at?: string
          value?: Json
        }
        Update: {
          class_level?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          importance?: number
          key?: string
          memory_type?: string
          owner_id?: string
          scope?: string
          source?: string | null
          subject?: string | null
          summary?: string | null
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      ai_skill_invocations: {
        Row: {
          caller_id: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          input_summary: Json
          output_summary: Json
          skill_key: string
          status: string
        }
        Insert: {
          caller_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          input_summary?: Json
          output_summary?: Json
          skill_key: string
          status?: string
        }
        Update: {
          caller_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          input_summary?: Json
          output_summary?: Json
          skill_key?: string
          status?: string
        }
        Relationships: []
      }
      ai_skills: {
        Row: {
          category: string
          created_at: string
          default_model: string | null
          description: string | null
          id: string
          input_schema: Json
          is_active: boolean
          name: string
          skill_key: string
          target_function: string
          updated_at: string
          version: number
        }
        Insert: {
          category?: string
          created_at?: string
          default_model?: string | null
          description?: string | null
          id?: string
          input_schema?: Json
          is_active?: boolean
          name: string
          skill_key: string
          target_function: string
          updated_at?: string
          version?: number
        }
        Update: {
          category?: string
          created_at?: string
          default_model?: string | null
          description?: string | null
          id?: string
          input_schema?: Json
          is_active?: boolean
          name?: string
          skill_key?: string
          target_function?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      alert_reads: {
        Row: {
          alert_id: string
          id: string
          read_at: string
          user_id: string
        }
        Insert: {
          alert_id: string
          id?: string
          read_at?: string
          user_id: string
        }
        Update: {
          alert_id?: string
          id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_reads_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "mismatch_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          auditory_score: number | null
          completed_at: string
          id: string
          kinesthetic_score: number | null
          mi_scores: Json | null
          reading_score: number | null
          student_id: string
          visual_score: number | null
          zpd_english: number | null
          zpd_math: number | null
          zpd_science: number | null
        }
        Insert: {
          auditory_score?: number | null
          completed_at?: string
          id?: string
          kinesthetic_score?: number | null
          mi_scores?: Json | null
          reading_score?: number | null
          student_id: string
          visual_score?: number | null
          zpd_english?: number | null
          zpd_math?: number | null
          zpd_science?: number | null
        }
        Update: {
          auditory_score?: number | null
          completed_at?: string
          id?: string
          kinesthetic_score?: number | null
          mi_scores?: Json | null
          reading_score?: number | null
          student_id?: string
          visual_score?: number | null
          zpd_english?: number | null
          zpd_math?: number | null
          zpd_science?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assessments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json
          id: string
          ip_address: string | null
          resource_id: string | null
          resource_type: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      automation_logs: {
        Row: {
          error_message: string | null
          executed_at: string
          id: string
          result: Json
          rule_id: string
          status: string
          trigger_data: Json
        }
        Insert: {
          error_message?: string | null
          executed_at?: string
          id?: string
          result?: Json
          rule_id: string
          status?: string
          trigger_data?: Json
        }
        Update: {
          error_message?: string | null
          executed_at?: string
          id?: string
          result?: Json
          rule_id?: string
          status?: string
          trigger_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          action_json: Json
          condition_json: Json
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          trigger_event: string
          updated_at: string
        }
        Insert: {
          action_json?: Json
          condition_json?: Json
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          trigger_event: string
          updated_at?: string
        }
        Update: {
          action_json?: Json
          condition_json?: Json
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          trigger_event?: string
          updated_at?: string
        }
        Relationships: []
      }
      class_students: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          class_id: string
          id: string
          student_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          class_id: string
          id?: string
          student_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          class_id?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_students_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_students_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      class_teachers: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          class_id: string
          id: string
          subject: string | null
          teacher_id: string
          teacher_role: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          class_id: string
          id?: string
          subject?: string | null
          teacher_id: string
          teacher_role?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          class_id?: string
          id?: string
          subject?: string | null
          teacher_id?: string
          teacher_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_teachers_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_teachers_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_teachers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          section: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          section?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          section?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_requests: {
        Row: {
          admin_notes: string | null
          approved_at: string | null
          approved_by: string | null
          approved_count: number | null
          assigned_at: string | null
          class_name: string
          completed_at: string | null
          created_at: string
          id: string
          purpose: string
          question_distribution: Json | null
          questions: Json | null
          section: string
          status: string
          subject: string
          suggested_count: number
          teacher_id: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_count?: number | null
          assigned_at?: string | null
          class_name: string
          completed_at?: string | null
          created_at?: string
          id?: string
          purpose: string
          question_distribution?: Json | null
          questions?: Json | null
          section?: string
          status?: string
          subject: string
          suggested_count: number
          teacher_id: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_count?: number | null
          assigned_at?: string | null
          class_name?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          purpose?: string
          question_distribution?: Json | null
          questions?: Json | null
          section?: string
          status?: string
          subject?: string
          suggested_count?: number
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_submissions: {
        Row: {
          answers: Json
          completed_at: string
          id: string
          request_id: string
          score: number
          student_id: string
          total_questions: number
        }
        Insert: {
          answers?: Json
          completed_at?: string
          id?: string
          request_id: string
          score?: number
          student_id: string
          total_questions?: number
        }
        Update: {
          answers?: Json
          completed_at?: string
          id?: string
          request_id?: string
          score?: number
          student_id?: string
          total_questions?: number
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_submissions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      game_sessions: {
        Row: {
          accuracy: number
          avg_response_time: number
          brain_level_at: string
          completed_at: string
          difficulty_reached: number
          game_category: string
          game_type: string
          id: string
          max_score: number
          score: number
          student_id: string
          subject: string | null
          time_used: number
        }
        Insert: {
          accuracy?: number
          avg_response_time?: number
          brain_level_at?: string
          completed_at?: string
          difficulty_reached?: number
          game_category: string
          game_type: string
          id?: string
          max_score?: number
          score?: number
          student_id: string
          subject?: string | null
          time_used?: number
        }
        Update: {
          accuracy?: number
          avg_response_time?: number
          brain_level_at?: string
          completed_at?: string
          difficulty_reached?: number
          game_category?: string
          game_type?: string
          id?: string
          max_score?: number
          score?: number
          student_id?: string
          subject?: string | null
          time_used?: number
        }
        Relationships: []
      }
      governance_notifications: {
        Row: {
          channel: string
          created_at: string
          event_type: string
          id: string
          is_read: boolean
          message: string
          reference_id: string | null
          reference_type: string | null
          title: string
          user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          event_type: string
          id?: string
          is_read?: boolean
          message: string
          reference_id?: string | null
          reference_type?: string | null
          title: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          event_type?: string
          id?: string
          is_read?: boolean
          message?: string
          reference_id?: string | null
          reference_type?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      homework_assignments: {
        Row: {
          assigned_at: string | null
          assigned_student_count: number | null
          assignment_type: string
          class_level: string
          class_performance_score: number | null
          created_at: string | null
          due_date: string | null
          exit_ticket_content: string | null
          id: string
          lesson_id: string | null
          period_number: number | null
          period_title: string | null
          section: string | null
          subject: string | null
          teacher_id: string
          topic: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_student_count?: number | null
          assignment_type?: string
          class_level: string
          class_performance_score?: number | null
          created_at?: string | null
          due_date?: string | null
          exit_ticket_content?: string | null
          id?: string
          lesson_id?: string | null
          period_number?: number | null
          period_title?: string | null
          section?: string | null
          subject?: string | null
          teacher_id: string
          topic?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_student_count?: number | null
          assignment_type?: string
          class_level?: string
          class_performance_score?: number | null
          created_at?: string | null
          due_date?: string | null
          exit_ticket_content?: string | null
          id?: string
          lesson_id?: string | null
          period_number?: number | null
          period_title?: string | null
          section?: string | null
          subject?: string | null
          teacher_id?: string
          topic?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          answers: Json | null
          assigned_at: string | null
          assignment_id: string
          completed: boolean | null
          created_at: string | null
          evaluated_at: string | null
          evaluated_by: string | null
          id: string
          student_id: string | null
          student_name: string | null
          submission_percentage: number | null
          submitted_at: string | null
          teacher_feedback: string | null
          teacher_score: number | null
          updated_at: string | null
        }
        Insert: {
          answers?: Json | null
          assigned_at?: string | null
          assignment_id: string
          completed?: boolean | null
          created_at?: string | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          id?: string
          student_id?: string | null
          student_name?: string | null
          submission_percentage?: number | null
          submitted_at?: string | null
          teacher_feedback?: string | null
          teacher_score?: number | null
          updated_at?: string | null
        }
        Update: {
          answers?: Json | null
          assigned_at?: string | null
          assignment_id?: string
          completed?: boolean | null
          created_at?: string | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          id?: string
          student_id?: string | null
          student_name?: string | null
          submission_percentage?: number | null
          submitted_at?: string | null
          teacher_feedback?: string | null
          teacher_score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          due_date: string
          id: string
          invoice_date: string
          paid_at: string | null
          status: string
          subscription_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          due_date?: string
          id?: string
          invoice_date?: string
          paid_at?: string | null
          status?: string
          subscription_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          due_date?: string
          id?: string
          invoice_date?: string
          paid_at?: string | null
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          chunk_text: string
          class_level: string | null
          created_at: string
          curriculum: string | null
          embedding_id: string | null
          file_name: string
          id: string
          source_type: string
          subject: string | null
        }
        Insert: {
          chunk_text: string
          class_level?: string | null
          created_at?: string
          curriculum?: string | null
          embedding_id?: string | null
          file_name: string
          id?: string
          source_type?: string
          subject?: string | null
        }
        Update: {
          chunk_text?: string
          class_level?: string | null
          created_at?: string
          curriculum?: string | null
          embedding_id?: string | null
          file_name?: string
          id?: string
          source_type?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_embedding_id_fkey"
            columns: ["embedding_id"]
            isOneToOne: false
            referencedRelation: "ai_embeddings"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          lesson_id: string
          status: string
          student_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          lesson_id: string
          status?: string
          student_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          lesson_id?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_assignments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          ai_generated: boolean | null
          approach: string | null
          class_level: string | null
          content: Json | null
          created_at: string
          curriculum: string | null
          delivery_method: string | null
          duration_minutes: number | null
          id: string
          learning_outcomes: string | null
          lesson_content: string | null
          periods_count: number | null
          section: string | null
          subject: string | null
          teacher_id: string | null
          title: string
          topic: string | null
          vark_target: string | null
        }
        Insert: {
          ai_generated?: boolean | null
          approach?: string | null
          class_level?: string | null
          content?: Json | null
          created_at?: string
          curriculum?: string | null
          delivery_method?: string | null
          duration_minutes?: number | null
          id?: string
          learning_outcomes?: string | null
          lesson_content?: string | null
          periods_count?: number | null
          section?: string | null
          subject?: string | null
          teacher_id?: string | null
          title: string
          topic?: string | null
          vark_target?: string | null
        }
        Update: {
          ai_generated?: boolean | null
          approach?: string | null
          class_level?: string | null
          content?: Json | null
          created_at?: string
          curriculum?: string | null
          delivery_method?: string | null
          duration_minutes?: number | null
          id?: string
          learning_outcomes?: string | null
          lesson_content?: string | null
          periods_count?: number | null
          section?: string | null
          subject?: string | null
          teacher_id?: string | null
          title?: string
          topic?: string | null
          vark_target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lessons_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mismatch_alerts: {
        Row: {
          created_at: string
          fail_rate: number | null
          id: string
          lesson_type: string | null
          recommendation: string | null
          status: string
          student_group: string | null
          trigger_condition: string | null
        }
        Insert: {
          created_at?: string
          fail_rate?: number | null
          id?: string
          lesson_type?: string | null
          recommendation?: string | null
          status?: string
          student_group?: string | null
          trigger_condition?: string | null
        }
        Update: {
          created_at?: string
          fail_rate?: number | null
          id?: string
          lesson_type?: string | null
          recommendation?: string | null
          status?: string
          student_group?: string | null
          trigger_condition?: string | null
        }
        Relationships: []
      }
      performance_records: {
        Row: {
          effort_score: number | null
          id: string
          lesson_id: string | null
          mastery_score: number | null
          normalized_gain: number | null
          posttest_score: number | null
          pretest_score: number | null
          recorded_at: string
          student_id: string
        }
        Insert: {
          effort_score?: number | null
          id?: string
          lesson_id?: string | null
          mastery_score?: number | null
          normalized_gain?: number | null
          posttest_score?: number | null
          pretest_score?: number | null
          recorded_at?: string
          student_id: string
        }
        Update: {
          effort_score?: number | null
          id?: string
          lesson_id?: string | null
          mastery_score?: number | null
          normalized_gain?: number | null
          posttest_score?: number | null
          pretest_score?: number | null
          recorded_at?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_records_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      period_plans: {
        Row: {
          class_level: string
          created_at: string
          id: string
          is_locked: boolean
          lesson_id: string
          period_duration: number
          periods_per_week: number
          plan_data: Json
          section: string
          subject: string | null
          teacher_id: string
          total_teaching_days: number
          updated_at: string
        }
        Insert: {
          class_level: string
          created_at?: string
          id?: string
          is_locked?: boolean
          lesson_id: string
          period_duration?: number
          periods_per_week?: number
          plan_data?: Json
          section: string
          subject?: string | null
          teacher_id: string
          total_teaching_days?: number
          updated_at?: string
        }
        Update: {
          class_level?: string
          created_at?: string
          id?: string
          is_locked?: boolean
          lesson_id?: string
          period_duration?: number
          periods_per_week?: number
          plan_data?: Json
          section?: string
          subject?: string | null
          teacher_id?: string
          total_teaching_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "period_plans_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          features: Json
          id: string
          is_active: boolean
          max_ai_generations: number
          max_storage_mb: number
          max_students: number
          max_teachers: number
          name: string
          price_monthly: number
          price_yearly: number
          tier: string
        }
        Insert: {
          created_at?: string
          features?: Json
          id?: string
          is_active?: boolean
          max_ai_generations?: number
          max_storage_mb?: number
          max_students?: number
          max_teachers?: number
          name: string
          price_monthly?: number
          price_yearly?: number
          tier?: string
        }
        Update: {
          created_at?: string
          features?: Json
          id?: string
          is_active?: boolean
          max_ai_generations?: number
          max_storage_mb?: number
          max_students?: number
          max_teachers?: number
          name?: string
          price_monthly?: number
          price_yearly?: number
          tier?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          class_grade: string | null
          created_at: string
          full_name: string | null
          gender: string | null
          id: string
          onboarding_completed: boolean
          preferred_language: string
          role: string
          school_name: string | null
          tour_completed: boolean
        }
        Insert: {
          avatar_url?: string | null
          class_grade?: string | null
          created_at?: string
          full_name?: string | null
          gender?: string | null
          id: string
          onboarding_completed?: boolean
          preferred_language?: string
          role?: string
          school_name?: string | null
          tour_completed?: boolean
        }
        Update: {
          avatar_url?: string | null
          class_grade?: string | null
          created_at?: string
          full_name?: string | null
          gender?: string | null
          id?: string
          onboarding_completed?: boolean
          preferred_language?: string
          role?: string
          school_name?: string | null
          tour_completed?: boolean
        }
        Relationships: []
      }
      school_metrics: {
        Row: {
          ai_usage_count: number | null
          created_at: string
          curriculum_coverage_pct: number | null
          id: string
          learning_gain_index: number | null
          risk_summary: Json | null
          snapshot_date: string
          subject_breakdown: Json | null
          teacher_rankings: Json | null
          teaching_effectiveness_score: number | null
          total_students: number | null
          total_teachers: number | null
        }
        Insert: {
          ai_usage_count?: number | null
          created_at?: string
          curriculum_coverage_pct?: number | null
          id?: string
          learning_gain_index?: number | null
          risk_summary?: Json | null
          snapshot_date?: string
          subject_breakdown?: Json | null
          teacher_rankings?: Json | null
          teaching_effectiveness_score?: number | null
          total_students?: number | null
          total_teachers?: number | null
        }
        Update: {
          ai_usage_count?: number | null
          created_at?: string
          curriculum_coverage_pct?: number | null
          id?: string
          learning_gain_index?: number | null
          risk_summary?: Json | null
          snapshot_date?: string
          subject_breakdown?: Json | null
          teacher_rankings?: Json | null
          teaching_effectiveness_score?: number | null
          total_students?: number | null
          total_teachers?: number | null
        }
        Relationships: []
      }
      student_assessments: {
        Row: {
          age_group: number
          created_at: string
          curriculum: string | null
          id: string
          responses: Json
          section: string | null
          student_age: number
          student_class: string | null
          student_name: string
          submitted_by: string
          teacher_id: string
        }
        Insert: {
          age_group: number
          created_at?: string
          curriculum?: string | null
          id?: string
          responses?: Json
          section?: string | null
          student_age: number
          student_class?: string | null
          student_name: string
          submitted_by?: string
          teacher_id: string
        }
        Update: {
          age_group?: number
          created_at?: string
          curriculum?: string | null
          id?: string
          responses?: Json
          section?: string | null
          student_age?: number
          student_class?: string | null
          student_name?: string
          submitted_by?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_assessments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_game_profiles: {
        Row: {
          age_stage: string
          avg_accuracy: number | null
          brain_level: string
          brain_xp: number
          created_at: string
          daily_goal: number
          games_today: number
          games_today_date: string | null
          id: string
          last_played_at: string | null
          preferred_subjects: string[] | null
          student_age: number | null
          student_id: string
          surprise_reward_available: boolean
          total_games_played: number
          total_time_played: number
          updated_at: string
        }
        Insert: {
          age_stage?: string
          avg_accuracy?: number | null
          brain_level?: string
          brain_xp?: number
          created_at?: string
          daily_goal?: number
          games_today?: number
          games_today_date?: string | null
          id?: string
          last_played_at?: string | null
          preferred_subjects?: string[] | null
          student_age?: number | null
          student_id: string
          surprise_reward_available?: boolean
          total_games_played?: number
          total_time_played?: number
          updated_at?: string
        }
        Update: {
          age_stage?: string
          avg_accuracy?: number | null
          brain_level?: string
          brain_xp?: number
          created_at?: string
          daily_goal?: number
          games_today?: number
          games_today_date?: string | null
          id?: string
          last_played_at?: string | null
          preferred_subjects?: string[] | null
          student_age?: number | null
          student_id?: string
          surprise_reward_available?: boolean
          total_games_played?: number
          total_time_played?: number
          updated_at?: string
        }
        Relationships: []
      }
      student_predictions: {
        Row: {
          confidence_score: number | null
          contributing_factors: Json | null
          created_at: string
          dropout_risk_percentage: number | null
          id: string
          predicted_score_next_test: number | null
          risk_level: string
          student_id: string
          subject: string
          updated_at: string
        }
        Insert: {
          confidence_score?: number | null
          contributing_factors?: Json | null
          created_at?: string
          dropout_risk_percentage?: number | null
          id?: string
          predicted_score_next_test?: number | null
          risk_level?: string
          student_id: string
          subject: string
          updated_at?: string
        }
        Update: {
          confidence_score?: number | null
          contributing_factors?: Json | null
          created_at?: string
          dropout_risk_percentage?: number | null
          id?: string
          predicted_score_next_test?: number | null
          risk_level?: string
          student_id?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      students: {
        Row: {
          age: number | null
          created_at: string
          curriculum: string | null
          date_of_birth: string | null
          dominant_intelligence: string | null
          grade: string | null
          id: string
          parent_email: string | null
          parent_phone: string | null
          profile_id: string
          roll_number: string | null
          vark_type: string | null
          zpd_score: number | null
        }
        Insert: {
          age?: number | null
          created_at?: string
          curriculum?: string | null
          date_of_birth?: string | null
          dominant_intelligence?: string | null
          grade?: string | null
          id?: string
          parent_email?: string | null
          parent_phone?: string | null
          profile_id: string
          roll_number?: string | null
          vark_type?: string | null
          zpd_score?: number | null
        }
        Update: {
          age?: number | null
          created_at?: string
          curriculum?: string | null
          date_of_birth?: string | null
          dominant_intelligence?: string | null
          grade?: string | null
          id?: string
          parent_email?: string | null
          parent_phone?: string | null
          profile_id?: string
          roll_number?: string | null
          vark_type?: string | null
          zpd_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "students_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_cycle: string
          created_at: string
          created_by: string
          current_period_end: string
          current_period_start: string
          id: string
          plan_id: string
          school_name: string
          status: string
          updated_at: string
        }
        Insert: {
          billing_cycle?: string
          created_at?: string
          created_by: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          plan_id: string
          school_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          billing_cycle?: string
          created_at?: string
          created_by?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          plan_id?: string
          school_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_assessments: {
        Row: {
          age_group: number
          created_at: string
          id: string
          responses: Json
          student_name: string
          student_profile_id: string
          teacher_id: string
        }
        Insert: {
          age_group: number
          created_at?: string
          id?: string
          responses?: Json
          student_name: string
          student_profile_id: string
          teacher_id: string
        }
        Update: {
          age_group?: number
          created_at?: string
          id?: string
          responses?: Json
          student_name?: string
          student_profile_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_assessments_student_profile_id_fkey"
            columns: ["student_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_assessments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_question_assignments: {
        Row: {
          age_group: number
          assigned_by: string | null
          created_at: string
          id: string
          question_indices: Json
          teacher_id: string
        }
        Insert: {
          age_group: number
          assigned_by?: string | null
          created_at?: string
          id?: string
          question_indices?: Json
          teacher_id: string
        }
        Update: {
          age_group?: number
          assigned_by?: string | null
          created_at?: string
          id?: string
          question_indices?: Json
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_question_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_question_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_metrics: {
        Row: {
          id: string
          metric_type: string
          metric_value: number
          recorded_at: string
          subscription_id: string | null
        }
        Insert: {
          id?: string
          metric_type: string
          metric_value?: number
          recorded_at?: string
          subscription_id?: string | null
        }
        Update: {
          id?: string
          metric_type?: string
          metric_value?: number
          recorded_at?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_metrics_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_achievements: {
        Row: {
          achievement_id: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievement_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_gamification: {
        Row: {
          current_streak: number
          id: string
          last_activity_date: string | null
          level: number
          longest_streak: number
          total_xp: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          id?: string
          last_activity_date?: string | null
          level?: number
          longest_streak?: number
          total_xp?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          id?: string
          last_activity_date?: string | null
          level?: number
          longest_streak?: number
          total_xp?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_gamification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_transactions: {
        Row: {
          action: string
          created_at: string
          description: string | null
          id: string
          user_id: string
          xp_amount: number
        }
        Insert: {
          action: string
          created_at?: string
          description?: string | null
          id?: string
          user_id: string
          xp_amount: number
        }
        Update: {
          action?: string
          created_at?: string
          description?: string | null
          id?: string
          user_id?: string
          xp_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "xp_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: { Args: { _user_id: string }; Returns: string }
      match_embeddings:
        | {
            Args: {
              match_count?: number
              match_threshold?: number
              query_embedding: string
            }
            Returns: {
              content: string
              id: string
              metadata: Json
              similarity: number
            }[]
          }
        | {
            Args: {
              match_count?: number
              match_threshold?: number
              query_embedding: string
              source_filter?: string[]
            }
            Returns: {
              content: string
              id: string
              metadata: Json
              similarity: number
              source_type: string
            }[]
          }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
