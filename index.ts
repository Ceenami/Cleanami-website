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
    PostgrestVersion: "13.0.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      availability: {
        Row: {
          availability_type: Database["public"]["Enums"]["availability_type"]
          cleaner_id: string
          created_at: string
          date: string
          end_time: string
          id: string
          is_grace_period: boolean | null
          on_call_eligible: boolean | null
          open_pool_eligible: boolean | null
          start_time: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          availability_type: Database["public"]["Enums"]["availability_type"]
          cleaner_id: string
          created_at?: string
          date: string
          end_time: string
          id?: string
          is_grace_period?: boolean | null
          on_call_eligible?: boolean | null
          open_pool_eligible?: boolean | null
          start_time: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          availability_type?: Database["public"]["Enums"]["availability_type"]
          cleaner_id?: string
          created_at?: string
          date?: string
          end_time?: string
          id?: string
          is_grace_period?: boolean | null
          on_call_eligible?: boolean | null
          open_pool_eligible?: boolean | null
          start_time?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
        ]
      }
      badges: {
        Row: {
          category: Database["public"]["Enums"]["badge_category"]
          created_at: string
          description: string
          icon: string
          id: string
          name: string
          points_value: number
          requirements: Json
        }
        Insert: {
          category: Database["public"]["Enums"]["badge_category"]
          created_at?: string
          description: string
          icon: string
          id?: string
          name: string
          points_value?: number
          requirements: Json
        }
        Update: {
          category?: Database["public"]["Enums"]["badge_category"]
          created_at?: string
          description?: string
          icon?: string
          id?: string
          name?: string
          points_value?: number
          requirements?: Json
        }
        Relationships: []
      }
      base_pricing_rules: {
        Row: {
          bedrooms: number
          created_at: string
          id: string
          price_1_bath_cents: number
          price_2_bath_cents: number
          price_3_bath_cents: number
          price_4_bath_cents: number
          price_5_bath_cents: number
          updated_at: string
        }
        Insert: {
          bedrooms: number
          created_at?: string
          id?: string
          price_1_bath_cents: number
          price_2_bath_cents: number
          price_3_bath_cents: number
          price_4_bath_cents: number
          price_5_bath_cents: number
          updated_at?: string
        }
        Update: {
          bedrooms?: number
          created_at?: string
          id?: string
          price_1_bath_cents?: number
          price_2_bath_cents?: number
          price_3_bath_cents?: number
          price_4_bath_cents?: number
          price_5_bath_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      capability_flags: {
        Row: {
          background_check_passed: boolean
          cleaner_id: string
          created_at: string
          hot_tub_capable: boolean
          id: string
          laundry_lead_eligible: boolean
          owns_vehicle: boolean
          team_leader_eligible: boolean
          updated_at: string
        }
        Insert: {
          background_check_passed?: boolean
          cleaner_id: string
          created_at?: string
          hot_tub_capable?: boolean
          id?: string
          laundry_lead_eligible?: boolean
          owns_vehicle?: boolean
          team_leader_eligible?: boolean
          updated_at?: string
        }
        Update: {
          background_check_passed?: boolean
          cleaner_id?: string
          created_at?: string
          hot_tub_capable?: boolean
          id?: string
          laundry_lead_eligible?: boolean
          owns_vehicle?: boolean
          team_leader_eligible?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capability_flags_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: true
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_files: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          property_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          property_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          property_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_files_property_id_properties_id_fk"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaner_badges: {
        Row: {
          badge_id: string
          cleaner_id: string
          earned_at: string
          id: string
          progress: Json | null
        }
        Insert: {
          badge_id: string
          cleaner_id: string
          earned_at?: string
          id?: string
          progress?: Json | null
        }
        Update: {
          badge_id?: string
          cleaner_id?: string
          earned_at?: string
          id?: string
          progress?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "cleaner_badges_badge_id_badges_id_fk"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaner_badges_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaners: {
        Row: {
          address: string | null
          created_at: string
          email: string
          experience_years: number | null
          full_name: string
          geocoded_at: string | null
          has_hot_tub_cert: boolean | null
          id: string
          latitude: number | null
          legal_docs_signed: Json | null
          longitude: number | null
          on_call_status: Database["public"]["Enums"]["on_call_status"] | null
          onboarding_completed: boolean | null
          onboarding_step: number | null
          phone_number: string | null
          profile_photo_url: string | null
          reliability_score: number | null
          stripe_account_id: string | null
          stripe_onboarding_complete: boolean | null
          travel_radius_miles: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          email: string
          experience_years?: number | null
          full_name: string
          geocoded_at?: string | null
          has_hot_tub_cert?: boolean | null
          id?: string
          latitude?: number | null
          legal_docs_signed?: Json | null
          longitude?: number | null
          on_call_status?: Database["public"]["Enums"]["on_call_status"] | null
          onboarding_completed?: boolean | null
          onboarding_step?: number | null
          phone_number?: string | null
          profile_photo_url?: string | null
          reliability_score?: number | null
          stripe_account_id?: string | null
          stripe_onboarding_complete?: boolean | null
          travel_radius_miles?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string
          experience_years?: number | null
          full_name?: string
          geocoded_at?: string | null
          has_hot_tub_cert?: boolean | null
          id?: string
          latitude?: number | null
          legal_docs_signed?: Json | null
          longitude?: number | null
          on_call_status?: Database["public"]["Enums"]["on_call_status"] | null
          onboarding_completed?: boolean | null
          onboarding_step?: number | null
          phone_number?: string | null
          profile_photo_url?: string | null
          reliability_score?: number | null
          stripe_account_id?: string | null
          stripe_onboarding_complete?: boolean | null
          travel_radius_miles?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cleaners_user_id_users_id_fk"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          phone_number: string | null
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          phone_number?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone_number?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      evidence_packets: {
        Row: {
          checklist_log: Json | null
          cleaner_notes: string | null
          created_at: string
          gps_check_in_timestamp: string | null
          gps_check_out_timestamp: string | null
          id: string
          is_checklist_complete: boolean | null
          job_id: string
          photo_urls: string[] | null
          status: Database["public"]["Enums"]["evidence_packet_status"] | null
          updated_at: string
        }
        Insert: {
          checklist_log?: Json | null
          cleaner_notes?: string | null
          created_at?: string
          gps_check_in_timestamp?: string | null
          gps_check_out_timestamp?: string | null
          id?: string
          is_checklist_complete?: boolean | null
          job_id: string
          photo_urls?: string[] | null
          status?: Database["public"]["Enums"]["evidence_packet_status"] | null
          updated_at?: string
        }
        Update: {
          checklist_log?: Json | null
          cleaner_notes?: string | null
          created_at?: string
          gps_check_in_timestamp?: string | null
          gps_check_out_timestamp?: string | null
          id?: string
          is_checklist_complete?: boolean | null
          job_id?: string
          photo_urls?: string[] | null
          status?: Database["public"]["Enums"]["evidence_packet_status"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_packets_job_id_jobs_id_fk"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      gps_tracking_logs: {
        Row: {
          accuracy: number | null
          activity_type: Database["public"]["Enums"]["activity_type"]
          cleaner_id: string
          created_at: string
          id: string
          job_id: string
          latitude: number
          longitude: number
          metadata: Json | null
        }
        Insert: {
          accuracy?: number | null
          activity_type: Database["public"]["Enums"]["activity_type"]
          cleaner_id: string
          created_at?: string
          id?: string
          job_id: string
          latitude: number
          longitude: number
          metadata?: Json | null
        }
        Update: {
          accuracy?: number | null
          activity_type?: Database["public"]["Enums"]["activity_type"]
          cleaner_id?: string
          created_at?: string
          id?: string
          job_id?: string
          latitude?: number
          longitude?: number
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "gps_tracking_logs_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gps_tracking_logs_job_id_jobs_id_fk"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      hot_tub_pricing_rules: {
        Row: {
          created_at: string
          customer_revenue_cents: number
          id: string
          service_type: string
          time_add_hours: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_revenue_cents: number
          id?: string
          service_type: string
          time_add_hours: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_revenue_cents?: number
          id?: string
          service_type?: string
          time_add_hours?: number
          updated_at?: string
        }
        Relationships: []
      }
      job_stats: {
        Row: {
          bonus_earned_cents: number
          cleaner_id: string
          completed_at: string | null
          created_at: string
          has_hot_tub: boolean
          id: string
          is_laundry_lead: boolean
          is_on_call: boolean
          is_team_leader: boolean
          job_id: string
          rating: number | null
        }
        Insert: {
          bonus_earned_cents?: number
          cleaner_id: string
          completed_at?: string | null
          created_at?: string
          has_hot_tub?: boolean
          id?: string
          is_laundry_lead?: boolean
          is_on_call?: boolean
          is_team_leader?: boolean
          job_id: string
          rating?: number | null
        }
        Update: {
          bonus_earned_cents?: number
          cleaner_id?: string
          completed_at?: string | null
          created_at?: string
          has_hot_tub?: boolean
          id?: string
          is_laundry_lead?: boolean
          is_on_call?: boolean
          is_team_leader?: boolean
          job_id?: string
          rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_stats_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_stats_job_id_jobs_id_fk"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          addons_snapshot: Json | null
          calendar_event_uid: string
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          expected_hours: number | null
          id: string
          notes: string | null
          payment_failed: boolean | null
          payment_intent_id: string | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          property_id: string | null
          status: Database["public"]["Enums"]["job_status"] | null
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          addons_snapshot?: Json | null
          calendar_event_uid: string
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          expected_hours?: number | null
          id?: string
          notes?: string | null
          payment_failed?: boolean | null
          payment_intent_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          property_id?: string | null
          status?: Database["public"]["Enums"]["job_status"] | null
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          addons_snapshot?: Json | null
          calendar_event_uid?: string
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          expected_hours?: number | null
          id?: string
          notes?: string | null
          payment_failed?: boolean | null
          payment_intent_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          property_id?: string | null
          status?: Database["public"]["Enums"]["job_status"] | null
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_property_id_properties_id_fk"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_subscription_id_subscriptions_id_fk"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs_to_cleaners: {
        Row: {
          cleaner_id: string
          created_at: string
          job_id: string
          role: Database["public"]["Enums"]["job_cleaner_role"]
          updated_at: string
          urgent_bonus: boolean | null
        }
        Insert: {
          cleaner_id: string
          created_at?: string
          job_id: string
          role: Database["public"]["Enums"]["job_cleaner_role"]
          updated_at?: string
          urgent_bonus?: boolean | null
        }
        Update: {
          cleaner_id?: string
          created_at?: string
          job_id?: string
          role?: Database["public"]["Enums"]["job_cleaner_role"]
          updated_at?: string
          urgent_bonus?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_to_cleaners_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_to_cleaners_job_id_jobs_id_fk"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      laundry_pricing_rules: {
        Row: {
          cleaner_bonus_per_load_cents: number
          created_at: string
          customer_revenue_base_cents: number
          customer_revenue_per_load_cents: number
          id: string
          service_type: string
          updated_at: string
        }
        Insert: {
          cleaner_bonus_per_load_cents: number
          created_at?: string
          customer_revenue_base_cents: number
          customer_revenue_per_load_cents: number
          id?: string
          service_type: string
          updated_at?: string
        }
        Update: {
          cleaner_bonus_per_load_cents?: number
          created_at?: string
          customer_revenue_base_cents?: number
          customer_revenue_per_load_cents?: number
          id?: string
          service_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          job_id: string | null
          message: string
          metadata: Json | null
          scheduled_for: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          job_id?: string | null
          message: string
          metadata?: Json | null
          scheduled_for?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          job_id?: string | null
          message?: string
          metadata?: Json | null
          scheduled_for?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_job_id_jobs_id_fk"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_users_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_documents: {
        Row: {
          cleaner_id: string
          created_at: string
          document_type: Database["public"]["Enums"]["document_type"]
          document_url: string | null
          id: string
          ip_address: string | null
          signed: boolean
          signed_at: string | null
          updated_at: string
        }
        Insert: {
          cleaner_id: string
          created_at?: string
          document_type: Database["public"]["Enums"]["document_type"]
          document_url?: string | null
          id?: string
          ip_address?: string | null
          signed?: boolean
          signed_at?: string | null
          updated_at?: string
        }
        Update: {
          cleaner_id?: string
          created_at?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          document_url?: string | null
          id?: string
          ip_address?: string | null
          signed?: boolean
          signed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_documents_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount: number
          cleaner_id: string
          created_at: string
          id: string
          job_id: string
          laundry_bonus_amount: number | null
          status: Database["public"]["Enums"]["payout_status"] | null
          stripe_payout_id: string | null
          updated_at: string
          urgent_bonus_amount: number | null
        }
        Insert: {
          amount: number
          cleaner_id: string
          created_at?: string
          id?: string
          job_id: string
          laundry_bonus_amount?: number | null
          status?: Database["public"]["Enums"]["payout_status"] | null
          stripe_payout_id?: string | null
          updated_at?: string
          urgent_bonus_amount?: number | null
        }
        Update: {
          amount?: number
          cleaner_id?: string
          created_at?: string
          id?: string
          job_id?: string
          laundry_bonus_amount?: number | null
          status?: Database["public"]["Enums"]["payout_status"] | null
          stripe_payout_id?: string | null
          updated_at?: string
          urgent_bonus_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payouts_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_job_id_jobs_id_fk"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_uploads: {
        Row: {
          created_at: string
          file_name: string
          file_url: string
          id: string
          notes: string | null
          status: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_url: string
          id?: string
          notes?: string | null
          status?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_url?: string
          id?: string
          notes?: string | null
          status?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_uploads_uploaded_by_users_id_fk"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string
          bath_count: number
          bed_count: number
          created_at: string
          customer_id: string
          geocoded_at: string | null
          has_hot_tub: boolean
          hot_tub_drain_cadence: string | null
          hot_tub_service: string | null
          ical_url: string | null
          id: string
          latitude: number | null
          laundry_loads: number | null
          laundry_type: string
          longitude: number | null
          needs_drain: boolean
          sq_ft: number | null
          updated_at: string
          use_default_check_lict: boolean
        }
        Insert: {
          address: string
          bath_count: number
          bed_count: number
          created_at?: string
          customer_id: string
          geocoded_at?: string | null
          has_hot_tub?: boolean
          hot_tub_drain_cadence?: string | null
          hot_tub_service?: string | null
          ical_url?: string | null
          id?: string
          latitude?: number | null
          laundry_loads?: number | null
          laundry_type: string
          longitude?: number | null
          needs_drain?: boolean
          sq_ft?: number | null
          updated_at?: string
          use_default_check_lict?: boolean
        }
        Update: {
          address?: string
          bath_count?: number
          bed_count?: number
          created_at?: string
          customer_id?: string
          geocoded_at?: string | null
          has_hot_tub?: boolean
          hot_tub_drain_cadence?: string | null
          hot_tub_service?: string | null
          ical_url?: string | null
          id?: string
          latitude?: number | null
          laundry_loads?: number | null
          laundry_type?: string
          longitude?: number | null
          needs_drain?: boolean
          sq_ft?: number | null
          updated_at?: string
          use_default_check_lict?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "properties_customer_id_customers_id_fk"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      push_notification_tokens: {
        Row: {
          cleaner_id: string
          created_at: string
          device_type: string | null
          id: string
          token: string
          updated_at: string
        }
        Insert: {
          cleaner_id: string
          created_at?: string
          device_type?: string | null
          id?: string
          token: string
          updated_at?: string
        }
        Update: {
          cleaner_id?: string
          created_at?: string
          device_type?: string | null
          id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_notification_tokens_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
        ]
      }
      reliability_checks: {
        Row: {
          actual_arrival_delay_minutes: number | null
          cleaner_id: string
          created_at: string
          expected_lateness:
            | Database["public"]["Enums"]["expected_lateness"]
            | null
          gps_arrival_at: string | null
          gps_departure_at: string | null
          id: string
          job_cancelled: boolean
          job_id: string
          manual_checkin_at: string | null
          manual_checkout_at: string | null
          notification_sent_at: string
          response_received_at: string | null
          updated_at: string
        }
        Insert: {
          actual_arrival_delay_minutes?: number | null
          cleaner_id: string
          created_at?: string
          expected_lateness?:
            | Database["public"]["Enums"]["expected_lateness"]
            | null
          gps_arrival_at?: string | null
          gps_departure_at?: string | null
          id?: string
          job_cancelled?: boolean
          job_id: string
          manual_checkin_at?: string | null
          manual_checkout_at?: string | null
          notification_sent_at?: string
          response_received_at?: string | null
          updated_at?: string
        }
        Update: {
          actual_arrival_delay_minutes?: number | null
          cleaner_id?: string
          created_at?: string
          expected_lateness?:
            | Database["public"]["Enums"]["expected_lateness"]
            | null
          gps_arrival_at?: string | null
          gps_departure_at?: string | null
          id?: string
          job_cancelled?: boolean
          job_id?: string
          manual_checkin_at?: string | null
          manual_checkout_at?: string | null
          notification_sent_at?: string
          response_received_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reliability_checks_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reliability_checks_job_id_jobs_id_fk"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      reliability_events: {
        Row: {
          cleaner_id: string
          created_at: string
          event_type: Database["public"]["Enums"]["reliability_event_type"]
          id: string
          job_id: string
          notes: string | null
          penalty_points: number
        }
        Insert: {
          cleaner_id: string
          created_at?: string
          event_type: Database["public"]["Enums"]["reliability_event_type"]
          id?: string
          job_id: string
          notes?: string | null
          penalty_points?: number
        }
        Update: {
          cleaner_id?: string
          created_at?: string
          event_type?: Database["public"]["Enums"]["reliability_event_type"]
          id?: string
          job_id?: string
          notes?: string | null
          penalty_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "reliability_events_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reliability_events_job_id_jobs_id_fk"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      reserve_transactions: {
        Row: {
          created_at: string
          id: string
          job_id: string
          net_amount_cents: number
          payment_intent_id: string
          reserve_amount_cents: number
          total_amount_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          net_amount_cents: number
          payment_intent_id: string
          reserve_amount_cents: number
          total_amount_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          net_amount_cents?: number
          payment_intent_id?: string
          reserve_amount_cents?: number
          total_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "reserve_transactions_job_id_jobs_id_fk"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      sqft_surcharge_rules: {
        Row: {
          created_at: string
          id: string
          is_custom_quote: boolean
          range_end: number
          range_start: number
          surcharge_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_custom_quote?: boolean
          range_end: number
          range_start: number
          surcharge_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_custom_quote?: boolean
          range_end?: number
          range_start?: number
          surcharge_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          customer_id: string
          duration_months: number
          end_date: string
          first_clean_payment_id: string | null
          ical_sync_failed: boolean | null
          id: string
          is_first_clean_prepaid: boolean
          last_sync_attempt: string | null
          property_id: string
          start_date: string
          status: string
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          duration_months: number
          end_date: string
          first_clean_payment_id?: string | null
          ical_sync_failed?: boolean | null
          id?: string
          is_first_clean_prepaid?: boolean
          last_sync_attempt?: string | null
          property_id: string
          start_date: string
          status?: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          duration_months?: number
          end_date?: string
          first_clean_payment_id?: string | null
          ical_sync_failed?: boolean | null
          id?: string
          is_first_clean_prepaid?: boolean
          last_sync_attempt?: string | null
          property_id?: string
          start_date?: string
          status?: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_customer_id_customers_id_fk"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_property_id_properties_id_fk"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_requests: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          job_id: string
          original_cleaner_id: string
          replacement_cleaner_id: string | null
          requested_at: string
          status: Database["public"]["Enums"]["swap_request_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          job_id: string
          original_cleaner_id: string
          replacement_cleaner_id?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["swap_request_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          job_id?: string
          original_cleaner_id?: string
          replacement_cleaner_id?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["swap_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "swap_requests_job_id_jobs_id_fk"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_original_cleaner_id_cleaners_id_fk"
            columns: ["original_cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_requests_replacement_cleaner_id_cleaners_id_fk"
            columns: ["replacement_cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          auto_photo_upload_enabled: boolean
          cleaner_id: string
          created_at: string
          email_notifications_enabled: boolean
          id: string
          location_tracking_enabled: boolean
          on_call_alerts_enabled: boolean
          preferred_language: string
          preferred_region: string
          push_notifications_enabled: boolean
          share_location_with_team: boolean
          sms_notifications_enabled: boolean
          theme: string
          updated_at: string
        }
        Insert: {
          auto_photo_upload_enabled?: boolean
          cleaner_id: string
          created_at?: string
          email_notifications_enabled?: boolean
          id?: string
          location_tracking_enabled?: boolean
          on_call_alerts_enabled?: boolean
          preferred_language?: string
          preferred_region?: string
          push_notifications_enabled?: boolean
          share_location_with_team?: boolean
          sms_notifications_enabled?: boolean
          theme?: string
          updated_at?: string
        }
        Update: {
          auto_photo_upload_enabled?: boolean
          cleaner_id?: string
          created_at?: string
          email_notifications_enabled?: boolean
          id?: string
          location_tracking_enabled?: boolean
          on_call_alerts_enabled?: boolean
          preferred_language?: string
          preferred_region?: string
          push_notifications_enabled?: boolean
          share_location_with_team?: boolean
          sms_notifications_enabled?: boolean
          theme?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_cleaner_id_cleaners_id_fk"
            columns: ["cleaner_id"]
            isOneToOne: true
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string | null
          role: string
          supabase_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name?: string | null
          role?: string
          supabase_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          role?: string
          supabase_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_lateness_penalty: {
        Args: { p_delay_minutes: number }
        Returns: number
      }
      calculate_reliability_score: {
        Args: { p_cleaner_id: string }
        Returns: number
      }
      check_swap_eligibility: {
        Args: { p_cleaner_id: string; p_job_id: string }
        Returns: {
          cleaner_id: string
          conflict_reason: string
          full_name: string
          is_eligible: boolean
          reliability_score: number
          swap_count: number
        }[]
      }
      get_cleaner_swap_count: {
        Args: { cleaner_uuid: string }
        Returns: number
      }
      get_leaderboard: {
        Args: never
        Returns: {
          badges_count: number
          cleaner_id: string
          full_name: string
          rank: number
          reliability_score: number
          total_earnings: number
          total_jobs: number
        }[]
      }
      handle_reliability_response: {
        Args: { p_expected_lateness: string; p_reliability_check_id: string }
        Returns: Json
      }
      job_has_assignments: { Args: { p_job_id: string }; Returns: boolean }
      send_reliability_notifications: { Args: never; Returns: undefined }
    }
    Enums: {
      activity_type: "arrival" | "working" | "departure"
      availability_type: "vacation_rental" | "residential"
      badge_category:
        | "reliability"
        | "performance"
        | "specialization"
        | "achievement"
      document_type:
        | "w9"
        | "contractor_agreement"
        | "liability_waiver"
        | "privacy_consent"
      evidence_packet_status: "complete" | "incomplete" | "pending_review"
      expected_lateness: "on_time" | "under_10" | "under_30" | "hour_plus"
      job_cleaner_role: "primary" | "backup" | "on-call" | "laundry_lead"
      job_status:
        | "unassigned"
        | "assigned"
        | "in-progress"
        | "completed"
        | "canceled"
      notification_type:
        | "job_reminder"
        | "photo_reminder"
        | "completion_reminder"
        | "urgent_job"
        | "payment_ready"
        | "reliability_check"
        | "swap_available"
      on_call_status: "available" | "unavailable" | "on_job"
      payment_status:
        | "pending"
        | "authorized"
        | "captured"
        | "failed"
        | "capture_failed"
      payout_status: "pending" | "released" | "held"
      reliability_event_type:
        | "late_arrival"
        | "no_show"
        | "call_out"
        | "on_time"
        | "early_arrival"
      swap_request_status:
        | "pending"
        | "accepted"
        | "expired"
        | "cancelled"
        | "urgent"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_type: ["arrival", "working", "departure"],
      availability_type: ["vacation_rental", "residential"],
      badge_category: [
        "reliability",
        "performance",
        "specialization",
        "achievement",
      ],
      document_type: [
        "w9",
        "contractor_agreement",
        "liability_waiver",
        "privacy_consent",
      ],
      evidence_packet_status: ["complete", "incomplete", "pending_review"],
      expected_lateness: ["on_time", "under_10", "under_30", "hour_plus"],
      job_cleaner_role: ["primary", "backup", "on-call", "laundry_lead"],
      job_status: [
        "unassigned",
        "assigned",
        "in-progress",
        "completed",
        "canceled",
      ],
      notification_type: [
        "job_reminder",
        "photo_reminder",
        "completion_reminder",
        "urgent_job",
        "payment_ready",
        "reliability_check",
        "swap_available",
      ],
      on_call_status: ["available", "unavailable", "on_job"],
      payment_status: [
        "pending",
        "authorized",
        "captured",
        "failed",
        "capture_failed",
      ],
      payout_status: ["pending", "released", "held"],
      reliability_event_type: [
        "late_arrival",
        "no_show",
        "call_out",
        "on_time",
        "early_arrival",
      ],
      swap_request_status: [
        "pending",
        "accepted",
        "expired",
        "cancelled",
        "urgent",
      ],
    },
  },
} as const
