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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      agent_keys: {
        Row: {
          allowed_tools: string[] | null
          created_at: string
          created_by: string | null
          daily_credit_cap: number | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at: string | null
          max_credits_per_call: number | null
          org_id: string
          revoked_at: string | null
          scopes: string[]
          total_credit_cap: number | null
        }
        Insert: {
          allowed_tools?: string[] | null
          created_at?: string
          created_by?: string | null
          daily_credit_cap?: number | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          label?: string
          last_used_at?: string | null
          max_credits_per_call?: number | null
          org_id: string
          revoked_at?: string | null
          scopes?: string[]
          total_credit_cap?: number | null
        }
        Update: {
          allowed_tools?: string[] | null
          created_at?: string
          created_by?: string | null
          daily_credit_cap?: number | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          label?: string
          last_used_at?: string | null
          max_credits_per_call?: number | null
          org_id?: string
          revoked_at?: string | null
          scopes?: string[]
          total_credit_cap?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_idempotency: {
        Row: {
          created_at: string
          expires_at: string | null
          idem_key: string
          key_id: string
          org_id: string
          response: Json | null
          tool_name: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          idem_key: string
          key_id: string
          org_id: string
          response?: Json | null
          tool_name: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          idem_key?: string
          key_id?: string
          org_id?: string
          response?: Json | null
          tool_name?: string
        }
        Relationships: []
      }
      api_rate_limits: {
        Row: {
          count: number
          key_id: string
          window_start: string
        }
        Insert: {
          count?: number
          key_id: string
          window_start: string
        }
        Update: {
          count?: number
          key_id?: string
          window_start?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          org_id: string
          payload: Json
          tool_name: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          org_id: string
          payload?: Json
          tool_name?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          org_id?: string
          payload?: Json
          tool_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_tokens: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          expires_at: string
          id: string
          org_id: string
          token_hash: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          expires_at: string
          id?: string
          org_id: string
          token_hash: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          org_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          org_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          created_at: string
          delta: number
          description: string | null
          external_ref: string | null
          id: string
          kind: string
          org_id: string
          source: string | null
          usage_event_id: string | null
        }
        Insert: {
          created_at?: string
          delta: number
          description?: string | null
          external_ref?: string | null
          id?: string
          kind: string
          org_id: string
          source?: string | null
          usage_event_id?: string | null
        }
        Update: {
          created_at?: string
          delta?: number
          description?: string | null
          external_ref?: string | null
          id?: string
          kind?: string
          org_id?: string
          source?: string | null
          usage_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_usage_event_id_fkey"
            columns: ["usage_event_id"]
            isOneToOne: false
            referencedRelation: "usage_events"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_purchases: {
        Row: {
          amount_cents: number | null
          created_at: string
          credits: number
          currency: string | null
          environment: string
          id: string
          org_id: string
          price_id: string
          quantity: number
          transaction_id: string
          user_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          credits: number
          currency?: string | null
          environment?: string
          id?: string
          org_id: string
          price_id: string
          quantity?: number
          transaction_id: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          credits?: number
          currency?: string | null
          environment?: string
          id?: string
          org_id?: string
          price_id?: string
          quantity?: number
          transaction_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_purchases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string
          id: string
          metadata: Json
          org_id: string
        }
        Insert: {
          chunk_index?: number
          content: string
          created_at?: string
          document_id: string
          embedding: string
          id?: string
          metadata?: Json
          org_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string
          id?: string
          metadata?: Json
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          content_type: string
          created_at: string
          id: string
          metadata: Json
          org_id: string
          source_url: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content_type?: string
          created_at?: string
          id?: string
          metadata?: Json
          org_id: string
          source_url?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content_type?: string
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string
          source_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          key: string
          org_id: string
          response: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          org_id: string
          response?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          key?: string
          org_id?: string
          response?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          conversation_id: string
          created_at: string
          error: string | null
          id: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          error?: string | null
          id?: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          error?: string | null
          id?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          error: string | null
          id: string
          org_id: string
          role: string
          status: string
          user_id: string | null
        }
        Insert: {
          content?: string
          conversation_id: string
          created_at?: string
          error?: string | null
          id?: string
          org_id: string
          role: string
          status?: string
          user_id?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          error?: string | null
          id?: string
          org_id?: string
          role?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          confirmation_default: string
          cost_quality_tier: string
          created_at: string
          default_model: string
          job_retention_days: number
          mcp_base_url: string
          mcp_path_pattern: string
          message_retention_days: number
          org_id: string
          updated_at: string
        }
        Insert: {
          confirmation_default?: string
          cost_quality_tier?: string
          created_at?: string
          default_model?: string
          job_retention_days?: number
          mcp_base_url?: string
          mcp_path_pattern?: string
          message_retention_days?: number
          org_id: string
          updated_at?: string
        }
        Update: {
          confirmation_default?: string
          cost_quality_tier?: string
          created_at?: string
          default_model?: string
          job_retention_days?: number
          mcp_base_url?: string
          mcp_path_pattern?: string
          message_retention_days?: number
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_tools: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          org_id: string
          requires_confirmation: boolean
          tool_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          org_id: string
          requires_confirmation?: boolean
          tool_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          org_id?: string
          requires_confirmation?: boolean
          tool_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_tools_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          claimed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          origin: string
          slug: string
          unlimited_credits: boolean
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          origin?: string
          slug: string
          unlimited_credits?: boolean
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          origin?: string
          slug?: string
          unlimited_credits?: boolean
        }
        Relationships: []
      }
      payment_intents: {
        Row: {
          amount_atomic: string
          amount_usd: number
          asset: string
          created_at: string
          credits: number
          error: string | null
          id: string
          key_id: string | null
          network: string
          nonce: string
          org_id: string
          pay_to: string
          payer: string | null
          purpose: string
          request_id: string | null
          settled_at: string | null
          status: string
          tool_name: string | null
          tx_hash: string | null
        }
        Insert: {
          amount_atomic: string
          amount_usd: number
          asset: string
          created_at?: string
          credits: number
          error?: string | null
          id?: string
          key_id?: string | null
          network: string
          nonce: string
          org_id: string
          pay_to: string
          payer?: string | null
          purpose?: string
          request_id?: string | null
          settled_at?: string | null
          status?: string
          tool_name?: string | null
          tx_hash?: string | null
        }
        Update: {
          amount_atomic?: string
          amount_usd?: number
          asset?: string
          created_at?: string
          credits?: number
          error?: string | null
          id?: string
          key_id?: string | null
          network?: string
          nonce?: string
          org_id?: string
          pay_to?: string
          payer?: string | null
          purpose?: string
          request_id?: string | null
          settled_at?: string | null
          status?: string
          tool_name?: string | null
          tx_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "agent_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          user_id: string
          window_start: string
        }
        Insert: {
          count?: number
          user_id: string
          window_start: string
        }
        Update: {
          count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      signup_attempts: {
        Row: {
          count: number
          ip_hash: string
          window_start: string
        }
        Insert: {
          count?: number
          ip_hash: string
          window_start: string
        }
        Update: {
          count?: number
          ip_hash?: string
          window_start?: string
        }
        Relationships: []
      }
      tool_calls: {
        Row: {
          args: Json
          conversation_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          error: string | null
          id: string
          message_id: string | null
          org_id: string
          result: Json | null
          side_effecting: boolean
          status: string
          tool_name: string
        }
        Insert: {
          args?: Json
          conversation_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          error?: string | null
          id?: string
          message_id?: string | null
          org_id: string
          result?: Json | null
          side_effecting?: boolean
          status?: string
          tool_name: string
        }
        Update: {
          args?: Json
          conversation_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          error?: string | null
          id?: string
          message_id?: string | null
          org_id?: string
          result?: Json | null
          side_effecting?: boolean
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_calls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_calls_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_confirmations: {
        Row: {
          args_hash: string
          created_at: string
          credits: number
          expires_at: string
          id: string
          key_id: string | null
          org_id: string
          preview: Json
          redeemed_at: string | null
          response: Json | null
          status: string
          token_hash: string
          tool_name: string
          updated_at: string
        }
        Insert: {
          args_hash: string
          created_at?: string
          credits?: number
          expires_at: string
          id?: string
          key_id?: string | null
          org_id: string
          preview?: Json
          redeemed_at?: string | null
          response?: Json | null
          status?: string
          token_hash: string
          tool_name: string
          updated_at?: string
        }
        Update: {
          args_hash?: string
          created_at?: string
          credits?: number
          expires_at?: string
          id?: string
          key_id?: string | null
          org_id?: string
          preview?: Json
          redeemed_at?: string | null
          response?: Json | null
          status?: string
          token_hash?: string
          tool_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_confirmations_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "agent_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_confirmations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_traces: {
        Row: {
          args: Json
          credits_charged: number
          duration_ms: number
          error: string | null
          finished_at: string | null
          id: string
          model: string | null
          org_id: string
          provider: string | null
          request_id: string | null
          result: Json | null
          started_at: string
          tool_name: string
        }
        Insert: {
          args?: Json
          credits_charged?: number
          duration_ms?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          model?: string | null
          org_id: string
          provider?: string | null
          request_id?: string | null
          result?: Json | null
          started_at?: string
          tool_name: string
        }
        Update: {
          args?: Json
          credits_charged?: number
          duration_ms?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          model?: string | null
          org_id?: string
          provider?: string | null
          request_id?: string | null
          result?: Json | null
          started_at?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_traces_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          credits: number
          error_code: string | null
          id: string
          key_id: string | null
          latency_ms: number
          org_id: string
          request_id: string | null
          status: string
          tool_name: string
        }
        Insert: {
          created_at?: string
          credits?: number
          error_code?: string | null
          id?: string
          key_id?: string | null
          latency_ms?: number
          org_id: string
          request_id?: string | null
          status?: string
          tool_name: string
        }
        Update: {
          created_at?: string
          credits?: number
          error_code?: string | null
          id?: string
          key_id?: string | null
          latency_ms?: number
          org_id?: string
          request_id?: string | null
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "agent_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_organization: { Args: { _token_hash: string }; Returns: string }
      consume_rate_limit:
        | { Args: { _key_id: string; _limit: number }; Returns: boolean }
        | { Args: { _max?: number }; Returns: boolean }
      consume_signup_quota: {
        Args: { _ip_hash: string; _max: number; _window_hours: number }
        Returns: boolean
      }
      has_org_access: { Args: { _org_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      key_credits_spent: {
        Args: { _key_id: string; _since: string }
        Returns: number
      }
      match_document_chunks: {
        Args: {
          _document_ids?: string[]
          _match_count?: number
          _org_id: string
          _query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          document_id: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      org_credit_balance: { Args: { _org_id: string }; Returns: number }
      org_role_of: {
        Args: { _org_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      org_unlimited_credits: { Args: { _org_id: string }; Returns: boolean }
      refund_reserved_credits: {
        Args: { _reason: string; _usage_event_id: string }
        Returns: boolean
      }
      reserve_credits: {
        Args: {
          _credits: number
          _daily_cap?: number
          _key_id: string
          _latency_ms?: number
          _max_per_call?: number
          _org_id: string
          _request_id: string
          _tool_name: string
          _total_cap?: number
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "member"
      org_role: "owner" | "admin" | "member"
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
    Enums: {
      app_role: ["super_admin", "admin", "member"],
      org_role: ["owner", "admin", "member"],
    },
  },
} as const
