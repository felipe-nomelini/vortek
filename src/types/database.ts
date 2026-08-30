export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      anuncios_ml: {
        Row: {
          catalogo: boolean
          created_at: string
          id: string
          ml_item_id: string
          ml_sync_block_reason: string | null
          ml_sync_blocked_until: string | null
          ml_sync_last_error: string | null
          permalink: string | null
          preco_ml: number
          produto_id: string | null
          qualidade: number
          qualidade_info: Json | null
          sku: string
          status: Database["public"]["Enums"]["ml_status"]
          thumbnail: string | null
          tipo: string
          titulo: string
          updated_at: string
          vendidos: number
          visitas: number
        }
        Insert: {
          catalogo?: boolean
          created_at?: string
          id?: string
          ml_item_id: string
          ml_sync_block_reason?: string | null
          ml_sync_blocked_until?: string | null
          ml_sync_last_error?: string | null
          permalink?: string | null
          preco_ml?: number
          produto_id?: string | null
          qualidade?: number
          qualidade_info?: Json | null
          sku: string
          status?: Database["public"]["Enums"]["ml_status"]
          thumbnail?: string | null
          tipo?: string
          titulo: string
          updated_at?: string
          vendidos?: number
          visitas?: number
        }
        Update: {
          catalogo?: boolean
          created_at?: string
          id?: string
          ml_item_id?: string
          ml_sync_block_reason?: string | null
          ml_sync_blocked_until?: string | null
          ml_sync_last_error?: string | null
          permalink?: string | null
          preco_ml?: number
          produto_id?: string | null
          qualidade?: number
          qualidade_info?: Json | null
          sku?: string
          status?: Database["public"]["Enums"]["ml_status"]
          thumbnail?: string | null
          tipo?: string
          titulo?: string
          updated_at?: string
          vendidos?: number
          visitas?: number
        }
        Relationships: [
          {
            foreignKeyName: "anuncios_ml_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      anuncios_ml_outbox: {
        Row: {
          attempts: number
          available_at: string
          created_at: string
          desired_price: number | null
          desired_quantity: number | null
          desired_status: Database["public"]["Enums"]["ml_status"] | null
          id: string
          last_error: string | null
          ml_item_id: string
          payload: Json
          processed_at: string | null
          produto_id: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          created_at?: string
          desired_price?: number | null
          desired_quantity?: number | null
          desired_status?: Database["public"]["Enums"]["ml_status"] | null
          id?: string
          last_error?: string | null
          ml_item_id: string
          payload?: Json
          processed_at?: string | null
          produto_id: string
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          created_at?: string
          desired_price?: number | null
          desired_quantity?: number | null
          desired_status?: Database["public"]["Enums"]["ml_status"] | null
          id?: string
          last_error?: string | null
          ml_item_id?: string
          payload?: Json
          processed_at?: string | null
          produto_id?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anuncios_ml_outbox_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogo_ml_refresh_items: {
        Row: {
          attempts: number
          created_at: string
          job_id: string
          last_error: string | null
          ml_item_id: string
          ordinal: number
          processed_at: string | null
          seller_id: number
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          job_id: string
          last_error?: string | null
          ml_item_id: string
          ordinal: number
          processed_at?: string | null
          seller_id: number
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          job_id?: string
          last_error?: string | null
          ml_item_id?: string
          ordinal?: number
          processed_at?: string | null
          seller_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_ml_refresh_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogo_ml_snapshot: {
        Row: {
          buy_box_status: string | null
          buy_box_winning: boolean
          catalog_listing: boolean
          catalog_product_id: string | null
          category_id: string | null
          created_at: string
          domain_id: string | null
          id: string
          last_updated_ml: string | null
          ml_item_id: string
          permalink: string | null
          price: number
          price_to_win: number | null
          produto_id: string | null
          refresh_job_id: string | null
          related_item_id: string | null
          related_permalink: string | null
          seller_id: number
          seller_sku: string | null
          sku_local: string | null
          status: string | null
          synced_at: string
          thumbnail: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          buy_box_status?: string | null
          buy_box_winning?: boolean
          catalog_listing?: boolean
          catalog_product_id?: string | null
          category_id?: string | null
          created_at?: string
          domain_id?: string | null
          id?: string
          last_updated_ml?: string | null
          ml_item_id: string
          permalink?: string | null
          price?: number
          price_to_win?: number | null
          produto_id?: string | null
          refresh_job_id?: string | null
          related_item_id?: string | null
          related_permalink?: string | null
          seller_id: number
          seller_sku?: string | null
          sku_local?: string | null
          status?: string | null
          synced_at?: string
          thumbnail?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          buy_box_status?: string | null
          buy_box_winning?: boolean
          catalog_listing?: boolean
          catalog_product_id?: string | null
          category_id?: string | null
          created_at?: string
          domain_id?: string | null
          id?: string
          last_updated_ml?: string | null
          ml_item_id?: string
          permalink?: string | null
          price?: number
          price_to_win?: number | null
          produto_id?: string | null
          refresh_job_id?: string | null
          related_item_id?: string | null
          related_permalink?: string | null
          seller_id?: number
          seller_sku?: string | null
          sku_local?: string | null
          status?: string | null
          synced_at?: string
          thumbnail?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_ml_snapshot_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogo_ml_snapshot_refresh_job_id_fkey"
            columns: ["refresh_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          created_at: string
          documento: string
          email: string
          endereco: string
          id: string
          ml_id: string | null
          ml_nickname: string | null
          nickname: string | null
          nome: string
          telefone: string
          tipo_pessoa: string
          total_vendas: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          documento?: string
          email?: string
          endereco?: string
          id?: string
          ml_id?: string | null
          ml_nickname?: string | null
          nickname?: string | null
          nome: string
          telefone?: string
          tipo_pessoa?: string
          total_vendas?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          documento?: string
          email?: string
          endereco?: string
          id?: string
          ml_id?: string | null
          ml_nickname?: string | null
          nickname?: string | null
          nome?: string
          telefone?: string
          tipo_pessoa?: string
          total_vendas?: number
          updated_at?: string
        }
        Relationships: []
      }
      compras: {
        Row: {
          created_at: string | null
          data_criacao: string | null
          destinatario_documento: string | null
          destinatario_nome: string | null
          dsid: string
          fornecedor_id: string | null
          fornecedor_nome: string | null
          id: string
          nf_chave: string | null
          nf_numero: string | null
          nf_serie: string | null
          produto_descricao: string | null
          produto_fornecedor_oferta_id: string | null
          produto_sku: string | null
          quantidade: number | null
          rastreio: string | null
          status: string | null
          status_dslite: string | null
          supplier_payment_amount: number | null
          supplier_payment_confirmed_at: string | null
          supplier_payment_confirmed_by: string | null
          supplier_payment_mode: string | null
          supplier_payment_notes: string | null
          supplier_payment_receipt_path: string | null
          supplier_payment_receipt_url: string | null
          supplier_payment_reference: string | null
          supplier_payment_status: string | null
          updated_at: string | null
          valor_frete: number | null
          valor_total: number | null
        }
        Insert: {
          created_at?: string | null
          data_criacao?: string | null
          destinatario_documento?: string | null
          destinatario_nome?: string | null
          dsid: string
          fornecedor_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          nf_chave?: string | null
          nf_numero?: string | null
          nf_serie?: string | null
          produto_descricao?: string | null
          produto_fornecedor_oferta_id?: string | null
          produto_sku?: string | null
          quantidade?: number | null
          rastreio?: string | null
          status?: string | null
          status_dslite?: string | null
          supplier_payment_amount?: number | null
          supplier_payment_confirmed_at?: string | null
          supplier_payment_confirmed_by?: string | null
          supplier_payment_mode?: string | null
          supplier_payment_notes?: string | null
          supplier_payment_receipt_path?: string | null
          supplier_payment_receipt_url?: string | null
          supplier_payment_reference?: string | null
          supplier_payment_status?: string | null
          updated_at?: string | null
          valor_frete?: number | null
          valor_total?: number | null
        }
        Update: {
          created_at?: string | null
          data_criacao?: string | null
          destinatario_documento?: string | null
          destinatario_nome?: string | null
          dsid?: string
          fornecedor_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          nf_chave?: string | null
          nf_numero?: string | null
          nf_serie?: string | null
          produto_descricao?: string | null
          produto_fornecedor_oferta_id?: string | null
          produto_sku?: string | null
          quantidade?: number | null
          rastreio?: string | null
          status?: string | null
          status_dslite?: string | null
          supplier_payment_amount?: number | null
          supplier_payment_confirmed_at?: string | null
          supplier_payment_confirmed_by?: string | null
          supplier_payment_mode?: string | null
          supplier_payment_notes?: string | null
          supplier_payment_receipt_path?: string | null
          supplier_payment_receipt_url?: string | null
          supplier_payment_reference?: string | null
          supplier_payment_status?: string | null
          updated_at?: string | null
          valor_frete?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_produto_fornecedor_oferta_id_fkey"
            columns: ["produto_fornecedor_oferta_id"]
            isOneToOne: false
            referencedRelation: "produto_fornecedor_ofertas"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes: {
        Row: {
          created_at: string
          id: string
          margem_lucro: number
          nfe_provider_default: string
          notificacoes_push: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          margem_lucro?: number
          nfe_provider_default?: string
          notificacoes_push?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          margem_lucro?: number
          nfe_provider_default?: string
          notificacoes_push?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      empresa: {
        Row: {
          cnpj: string
          cod_municipio_fiscal: string | null
          created_at: string
          email: string
          endereco: string
          id: string
          nickname: string
          nome: string
          telefone: string
          uf_fiscal: string
          updated_at: string
        }
        Insert: {
          cnpj?: string
          cod_municipio_fiscal?: string | null
          created_at?: string
          email?: string
          endereco?: string
          id?: string
          nickname?: string
          nome?: string
          telefone?: string
          uf_fiscal: string
          updated_at?: string
        }
        Update: {
          cnpj?: string
          cod_municipio_fiscal?: string | null
          created_at?: string
          email?: string
          endereco?: string
          id?: string
          nickname?: string
          nome?: string
          telefone?: string
          uf_fiscal?: string
          updated_at?: string
        }
        Relationships: []
      }
      estoque_interno_movimentacoes: {
        Row: {
          created_at: string
          custo_unitario: number | null
          disponivel_venda: boolean
          estornada_em: string | null
          estorno_motivo: string | null
          id: string
          motivo: string
          origem_entrada: string | null
          pedido_id: string | null
          produto_id: string
          quantidade: number
          situacao_estoque: string
          status_devolucao: string
          tipo: string
        }
        Insert: {
          created_at?: string
          custo_unitario?: number | null
          disponivel_venda?: boolean
          estornada_em?: string | null
          estorno_motivo?: string | null
          id?: string
          motivo: string
          origem_entrada?: string | null
          pedido_id?: string | null
          produto_id: string
          quantidade: number
          situacao_estoque?: string
          status_devolucao?: string
          tipo: string
        }
        Update: {
          created_at?: string
          custo_unitario?: number | null
          disponivel_venda?: boolean
          estornada_em?: string | null
          estorno_motivo?: string | null
          id?: string
          motivo?: string
          origem_entrada?: string | null
          pedido_id?: string | null
          produto_id?: string
          quantidade?: number
          situacao_estoque?: string
          status_devolucao?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "estoque_interno_movimentacoes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_interno_movimentacoes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operacionais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_interno_movimentacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      fornecedores: {
        Row: {
          apelido: string
          ativo: boolean
          cnpj: string
          created_at: string
          crossdocking: string
          dropshipping: string
          dslite_id: string | null
          dslite_ultima_sync: string | null
          email: string
          endereco: string
          id: string
          nome: string
          payload_dslite: Json
          status_dslite: string
          supplier_pix_key: string
          telefone: string
          updated_at: string
        }
        Insert: {
          apelido?: string
          ativo?: boolean
          cnpj?: string
          created_at?: string
          crossdocking?: string
          dropshipping?: string
          dslite_id?: string | null
          dslite_ultima_sync?: string | null
          email?: string
          endereco?: string
          id?: string
          nome: string
          payload_dslite?: Json
          status_dslite?: string
          supplier_pix_key?: string
          telefone?: string
          updated_at?: string
        }
        Update: {
          apelido?: string
          ativo?: boolean
          cnpj?: string
          created_at?: string
          crossdocking?: string
          dropshipping?: string
          dslite_id?: string | null
          dslite_ultima_sync?: string | null
          email?: string
          endereco?: string
          id?: string
          nome?: string
          payload_dslite?: Json
          status_dslite?: string
          supplier_pix_key?: string
          telefone?: string
          updated_at?: string
        }
        Relationships: []
      }
      integracoes: {
        Row: {
          access_token: string | null
          client_id: string | null
          client_secret: string | null
          conectado: boolean
          created_at: string
          id: string
          last_refresh_at: string | null
          last_refresh_error: string | null
          last_refresh_error_code: string | null
          redirect_uri: string | null
          refresh_lock_token: string | null
          refresh_lock_until: string | null
          refresh_token: string | null
          tipo: Database["public"]["Enums"]["integracao_tipo"]
          token_expires_at: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          access_token?: string | null
          client_id?: string | null
          client_secret?: string | null
          conectado?: boolean
          created_at?: string
          id?: string
          last_refresh_at?: string | null
          last_refresh_error?: string | null
          last_refresh_error_code?: string | null
          redirect_uri?: string | null
          refresh_lock_token?: string | null
          refresh_lock_until?: string | null
          refresh_token?: string | null
          tipo: Database["public"]["Enums"]["integracao_tipo"]
          token_expires_at?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          access_token?: string | null
          client_id?: string | null
          client_secret?: string | null
          conectado?: boolean
          created_at?: string
          id?: string
          last_refresh_at?: string | null
          last_refresh_error?: string | null
          last_refresh_error_code?: string | null
          redirect_uri?: string | null
          refresh_lock_token?: string | null
          refresh_lock_until?: string | null
          refresh_token?: string | null
          tipo?: Database["public"]["Enums"]["integracao_tipo"]
          token_expires_at?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          cancelado: boolean
          created_at: string
          created_by: string | null
          dedupe_key: string | null
          finished_at: string | null
          id: string
          log: Json
          processados: number
          progresso: number
          status: string
          tipo: string
          total: number
        }
        Insert: {
          cancelado?: boolean
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          finished_at?: string | null
          id?: string
          log?: Json
          processados?: number
          progresso?: number
          status?: string
          tipo: string
          total?: number
        }
        Update: {
          cancelado?: boolean
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          finished_at?: string | null
          id?: string
          log?: Json
          processados?: number
          progresso?: number
          status?: string
          tipo?: string
          total?: number
        }
        Relationships: []
      }
      mercadopago_account_movements: {
        Row: {
          amount: number
          created_at: string
          currency: string | null
          description: string | null
          external_id: string
          id: string
          matched_supplier: string | null
          movement_date: string | null
          movement_type: string | null
          raw_payload: Json
          reference: string | null
          supplier_balance_movement_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string | null
          description?: string | null
          external_id: string
          id?: string
          matched_supplier?: string | null
          movement_date?: string | null
          movement_type?: string | null
          raw_payload?: Json
          reference?: string | null
          supplier_balance_movement_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string | null
          description?: string | null
          external_id?: string
          id?: string
          matched_supplier?: string | null
          movement_date?: string | null
          movement_type?: string | null
          raw_payload?: Json
          reference?: string | null
          supplier_balance_movement_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mercadopago_account_movements_supplier_balance_movement_id_fkey"
            columns: ["supplier_balance_movement_id"]
            isOneToOne: false
            referencedRelation: "supplier_balance_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_manual_blocklist: {
        Row: {
          ativo: boolean
          created_at: string
          created_by: string | null
          id: string
          ml_item_id: string | null
          motivo: string | null
          sku: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          ml_item_id?: string | null
          motivo?: string | null
          sku?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          ml_item_id?: string | null
          motivo?: string | null
          sku?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ml_p0_phase3_remote_items: {
        Row: {
          confidence: number
          created_at: string
          evidence: Json
          id: string
          match_type: string
          ml_item_id: string
          run_id: string
          sku: string
        }
        Insert: {
          confidence: number
          created_at?: string
          evidence?: Json
          id?: string
          match_type: string
          ml_item_id: string
          run_id: string
          sku: string
        }
        Update: {
          confidence?: number
          created_at?: string
          evidence?: Json
          id?: string
          match_type?: string
          ml_item_id?: string
          run_id?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_p0_phase3_remote_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ml_p0_phase3_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_p0_phase3_results: {
        Row: {
          audit_payload: Json
          created_at: string
          documentation_score: number
          duplicate_risk: number
          fornecedor_nome: string | null
          id: string
          identity_confidence: number
          produto_id: string
          publication_readiness: number
          recommended_action: string
          remote_match_confidence: number
          run_id: string
          sku: string
        }
        Insert: {
          audit_payload?: Json
          created_at?: string
          documentation_score: number
          duplicate_risk: number
          fornecedor_nome?: string | null
          id?: string
          identity_confidence: number
          produto_id: string
          publication_readiness: number
          recommended_action: string
          remote_match_confidence: number
          run_id: string
          sku: string
        }
        Update: {
          audit_payload?: Json
          created_at?: string
          documentation_score?: number
          duplicate_risk?: number
          fornecedor_nome?: string | null
          id?: string
          identity_confidence?: number
          produto_id?: string
          publication_readiness?: number
          recommended_action?: string
          remote_match_confidence?: number
          run_id?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_p0_phase3_results_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_p0_phase3_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ml_p0_phase3_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_p0_phase3_runs: {
        Row: {
          completed_at: string | null
          id: string
          infrastructure_metrics: Json
          mode: string
          result_summary: Json
          source_population_hash: string
          source_sanitize_run_id: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          infrastructure_metrics?: Json
          mode?: string
          result_summary?: Json
          source_population_hash: string
          source_sanitize_run_id: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          infrastructure_metrics?: Json
          mode?: string
          result_summary?: Json
          source_population_hash?: string
          source_sanitize_run_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_p0_phase3_runs_source_sanitize_run_id_fkey"
            columns: ["source_sanitize_run_id"]
            isOneToOne: false
            referencedRelation: "ml_p0_sanitize_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_p0_population_snapshots: {
        Row: {
          captured_at: string
          fornecedor_id: string
          fornecedor_nome: string
          id: string
          job_id: string
          oferta_preferencial_id: string
          produto_id: string
          sku: string
          snapshot: Json
        }
        Insert: {
          captured_at?: string
          fornecedor_id: string
          fornecedor_nome: string
          id?: string
          job_id: string
          oferta_preferencial_id: string
          produto_id: string
          sku: string
          snapshot: Json
        }
        Update: {
          captured_at?: string
          fornecedor_id?: string
          fornecedor_nome?: string
          id?: string
          job_id?: string
          oferta_preferencial_id?: string
          produto_id?: string
          sku?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ml_p0_population_snapshots_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_p0_population_snapshots_oferta_preferencial_id_fkey"
            columns: ["oferta_preferencial_id"]
            isOneToOne: false
            referencedRelation: "produto_fornecedor_ofertas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_p0_population_snapshots_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_p0_publication_audits: {
        Row: {
          audit_status: string | null
          block_reason: string | null
          completed_at: string | null
          confidence_score: number | null
          content_snapshot: Json
          created_at: string
          dslite_raw: Json
          duplicate_audit: Json
          eligibility_drift: Json
          event_log: Json
          evidence_ledger: Json
          fornecedor_id: string
          fornecedor_nome: string
          id: string
          image_audit: Json
          job_id: string
          level0_snapshot: Json
          ml_item_id: string | null
          ml_schema_audit: Json
          official_sources: Json
          population_snapshot_id: string
          pricing_snapshot: Json
          priority_rank: number | null
          produto_id: string
          publication_action: string | null
          sku: string
          started_at: string | null
          updated_at: string
          validation_status: string | null
        }
        Insert: {
          audit_status?: string | null
          block_reason?: string | null
          completed_at?: string | null
          confidence_score?: number | null
          content_snapshot?: Json
          created_at?: string
          dslite_raw?: Json
          duplicate_audit?: Json
          eligibility_drift?: Json
          event_log?: Json
          evidence_ledger?: Json
          fornecedor_id: string
          fornecedor_nome: string
          id?: string
          image_audit?: Json
          job_id: string
          level0_snapshot?: Json
          ml_item_id?: string | null
          ml_schema_audit?: Json
          official_sources?: Json
          population_snapshot_id: string
          pricing_snapshot?: Json
          priority_rank?: number | null
          produto_id: string
          publication_action?: string | null
          sku: string
          started_at?: string | null
          updated_at?: string
          validation_status?: string | null
        }
        Update: {
          audit_status?: string | null
          block_reason?: string | null
          completed_at?: string | null
          confidence_score?: number | null
          content_snapshot?: Json
          created_at?: string
          dslite_raw?: Json
          duplicate_audit?: Json
          eligibility_drift?: Json
          event_log?: Json
          evidence_ledger?: Json
          fornecedor_id?: string
          fornecedor_nome?: string
          id?: string
          image_audit?: Json
          job_id?: string
          level0_snapshot?: Json
          ml_item_id?: string | null
          ml_schema_audit?: Json
          official_sources?: Json
          population_snapshot_id?: string
          pricing_snapshot?: Json
          priority_rank?: number | null
          produto_id?: string
          publication_action?: string | null
          sku?: string
          started_at?: string | null
          updated_at?: string
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_p0_publication_audits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_p0_publication_audits_population_snapshot_id_fkey"
            columns: ["population_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ml_p0_population_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_p0_publication_audits_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_p0_sanitize_results: {
        Row: {
          audit_payload: Json
          block_reason: string | null
          created_at: string
          documentary_score: number | null
          fornecedor_id: string
          fornecedor_nome: string
          gtin_status: string | null
          id: string
          new_status: string
          phase1_audit_id: string
          population_snapshot_id: string
          previous_error: string | null
          previous_status: string
          produto_id: string
          publication_score: number
          remote_listing_found: boolean
          remote_lookup_status: string
          run_id: string
          sku: string
          source_status: string
          structural_score: number
          updated_at: string
        }
        Insert: {
          audit_payload?: Json
          block_reason?: string | null
          created_at?: string
          documentary_score?: number | null
          fornecedor_id: string
          fornecedor_nome: string
          gtin_status?: string | null
          id?: string
          new_status: string
          phase1_audit_id: string
          population_snapshot_id: string
          previous_error?: string | null
          previous_status: string
          produto_id: string
          publication_score: number
          remote_listing_found?: boolean
          remote_lookup_status: string
          run_id: string
          sku: string
          source_status: string
          structural_score: number
          updated_at?: string
        }
        Update: {
          audit_payload?: Json
          block_reason?: string | null
          created_at?: string
          documentary_score?: number | null
          fornecedor_id?: string
          fornecedor_nome?: string
          gtin_status?: string | null
          id?: string
          new_status?: string
          phase1_audit_id?: string
          population_snapshot_id?: string
          previous_error?: string | null
          previous_status?: string
          produto_id?: string
          publication_score?: number
          remote_listing_found?: boolean
          remote_lookup_status?: string
          run_id?: string
          sku?: string
          source_status?: string
          structural_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_p0_sanitize_results_phase1_audit_id_fkey"
            columns: ["phase1_audit_id"]
            isOneToOne: false
            referencedRelation: "ml_p0_publication_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_p0_sanitize_results_population_snapshot_id_fkey"
            columns: ["population_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ml_p0_population_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_p0_sanitize_results_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_p0_sanitize_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ml_p0_sanitize_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_p0_sanitize_runs: {
        Row: {
          completed_at: string | null
          expected_reprocess_count: number
          id: string
          infrastructure_metrics: Json
          mode: string
          result_summary: Json
          source_job_id: string
          source_population_hash: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          expected_reprocess_count?: number
          id?: string
          infrastructure_metrics?: Json
          mode?: string
          result_summary?: Json
          source_job_id: string
          source_population_hash: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          expected_reprocess_count?: number
          id?: string
          infrastructure_metrics?: Json
          mode?: string
          result_summary?: Json
          source_job_id?: string
          source_population_hash?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_p0_sanitize_runs_source_job_id_fkey"
            columns: ["source_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      municipios_ibge: {
        Row: {
          cep_fim: string | null
          cep_inicio: string | null
          codigo_ibge: string
          created_at: string
          id: string
          nome: string
          nome_normalizado: string
          uf: string
          updated_at: string
        }
        Insert: {
          cep_fim?: string | null
          cep_inicio?: string | null
          codigo_ibge: string
          created_at?: string
          id?: string
          nome: string
          nome_normalizado: string
          uf: string
          updated_at?: string
        }
        Update: {
          cep_fim?: string | null
          cep_inicio?: string | null
          codigo_ibge?: string
          created_at?: string
          id?: string
          nome?: string
          nome_normalizado?: string
          uf?: string
          updated_at?: string
        }
        Relationships: []
      }
      nf_auditoria_eventos: {
        Row: {
          created_at: string
          evento: string
          id: string
          ml_order_id: string | null
          ml_pack_id: string | null
          payload_enviado: Json | null
          pedido_id: string | null
          resposta_ml: Json | null
          status_resultante: string | null
        }
        Insert: {
          created_at?: string
          evento: string
          id?: string
          ml_order_id?: string | null
          ml_pack_id?: string | null
          payload_enviado?: Json | null
          pedido_id?: string | null
          resposta_ml?: Json | null
          status_resultante?: string | null
        }
        Update: {
          created_at?: string
          evento?: string
          id?: string
          ml_order_id?: string | null
          ml_pack_id?: string | null
          payload_enviado?: Json | null
          pedido_id?: string | null
          resposta_ml?: Json | null
          status_resultante?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nf_auditoria_eventos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nf_auditoria_eventos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operacionais"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_whatsapp_events: {
        Row: {
          action: string | null
          chat_id: string
          command: string | null
          created_at: string
          direction: string
          error: string | null
          id: string
          issue_number: number | null
          message: string | null
          payload: Json | null
          phone: string | null
          status: string
        }
        Insert: {
          action?: string | null
          chat_id: string
          command?: string | null
          created_at?: string
          direction: string
          error?: string | null
          id?: string
          issue_number?: number | null
          message?: string | null
          payload?: Json | null
          phone?: string | null
          status: string
        }
        Update: {
          action?: string | null
          chat_id?: string
          command?: string | null
          created_at?: string
          direction?: string
          error?: string | null
          id?: string
          issue_number?: number | null
          message?: string | null
          payload?: Json | null
          phone?: string | null
          status?: string
        }
        Relationships: []
      }
      pedido_itens: {
        Row: {
          cest: string | null
          cfop_sugerido: string | null
          created_at: string
          csosn: string | null
          desconto_item: number
          frete_rateado_item: number
          gtin: string | null
          id: string
          ml_item_id: string | null
          ml_order_id: string | null
          ncm: string | null
          origem_fiscal: string | null
          pedido_id: string
          quantidade: number
          seller_sku: string | null
          titulo: string
          unidade: string | null
          updated_at: string
          valor_total_bruto: number
          valor_total_liquido: number
          valor_unitario: number
        }
        Insert: {
          cest?: string | null
          cfop_sugerido?: string | null
          created_at?: string
          csosn?: string | null
          desconto_item?: number
          frete_rateado_item?: number
          gtin?: string | null
          id?: string
          ml_item_id?: string | null
          ml_order_id?: string | null
          ncm?: string | null
          origem_fiscal?: string | null
          pedido_id: string
          quantidade?: number
          seller_sku?: string | null
          titulo?: string
          unidade?: string | null
          updated_at?: string
          valor_total_bruto?: number
          valor_total_liquido?: number
          valor_unitario?: number
        }
        Update: {
          cest?: string | null
          cfop_sugerido?: string | null
          created_at?: string
          csosn?: string | null
          desconto_item?: number
          frete_rateado_item?: number
          gtin?: string | null
          id?: string
          ml_item_id?: string | null
          ml_order_id?: string | null
          ncm?: string | null
          origem_fiscal?: string | null
          pedido_id?: string
          quantidade?: number
          seller_sku?: string | null
          titulo?: string
          unidade?: string | null
          updated_at?: string
          valor_total_bruto?: number
          valor_total_liquido?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "pedido_itens_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_itens_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operacionais"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          billing_documento: string | null
          billing_endereco: Json | null
          billing_ie: string | null
          billing_nome: string | null
          billing_tipo_pessoa: string | null
          buyer_ml_id: string | null
          contato_documento: string
          contato_nome: string
          created_at: string
          data: string
          data_prevista: string | null
          data_saida: string | null
          data_venda: string | null
          data_venda_source: string | null
          dslite_etiqueta_enviada: boolean | null
          dslite_id: string | null
          dslite_label_source: string | null
          dslite_status: string | null
          envio_interno_at: string | null
          frete: number
          fulfillment_selected_at: string | null
          fulfillment_source: string | null
          id: string
          lucro: number
          ml_bundle_parent_item_id: string | null
          ml_bundle_primary: boolean | null
          ml_bundle_type: string | null
          ml_claim_id: string | null
          ml_claim_status: string | null
          ml_fiscal_release_at: string | null
          ml_fiscal_release_checked_at: string | null
          ml_fiscal_release_reason: string | null
          ml_fiscal_release_source: string | null
          ml_invoice_id: string | null
          ml_invoice_reported: boolean | null
          ml_label_bytes: number | null
          ml_label_downloaded_at: string | null
          ml_label_storage_path: string | null
          ml_label_url: string | null
          ml_order_id: string | null
          ml_pack_id: string | null
          ml_shipment_id: string | null
          ml_thermal_label_bytes: number | null
          ml_thermal_label_downloaded_at: string | null
          ml_thermal_label_storage_path: string | null
          nfe_cfop: string | null
          nfe_chave: string | null
          nfe_danfe_url: string | null
          nfe_external_id: string | null
          nfe_last_sync_at: string | null
          nfe_protocolo: string | null
          nfe_provider: string | null
          nfe_status: string | null
          nfe_xml: string | null
          nota_fiscal_emitida: boolean
          nota_fiscal_numero: string | null
          numero: number
          numero_loja: string | null
          pagamento_resumo: Json | null
          rastreio: string | null
          sincronizado_em: string | null
          situacao: Database["public"]["Enums"]["pedido_status"]
          snapshot_incompleto: boolean
          snapshot_pendencias: Json | null
          snapshot_source: string | null
          snapshot_version: number
          totais_snapshot: Json | null
          total: number
          updated_at: string
        }
        Insert: {
          billing_documento?: string | null
          billing_endereco?: Json | null
          billing_ie?: string | null
          billing_nome?: string | null
          billing_tipo_pessoa?: string | null
          buyer_ml_id?: string | null
          contato_documento?: string
          contato_nome: string
          created_at?: string
          data?: string
          data_prevista?: string | null
          data_saida?: string | null
          data_venda?: string | null
          data_venda_source?: string | null
          dslite_etiqueta_enviada?: boolean | null
          dslite_id?: string | null
          dslite_label_source?: string | null
          dslite_status?: string | null
          envio_interno_at?: string | null
          frete?: number
          fulfillment_selected_at?: string | null
          fulfillment_source?: string | null
          id?: string
          lucro?: number
          ml_bundle_parent_item_id?: string | null
          ml_bundle_primary?: boolean | null
          ml_bundle_type?: string | null
          ml_claim_id?: string | null
          ml_claim_status?: string | null
          ml_fiscal_release_at?: string | null
          ml_fiscal_release_checked_at?: string | null
          ml_fiscal_release_reason?: string | null
          ml_fiscal_release_source?: string | null
          ml_invoice_id?: string | null
          ml_invoice_reported?: boolean | null
          ml_label_bytes?: number | null
          ml_label_downloaded_at?: string | null
          ml_label_storage_path?: string | null
          ml_label_url?: string | null
          ml_order_id?: string | null
          ml_pack_id?: string | null
          ml_shipment_id?: string | null
          ml_thermal_label_bytes?: number | null
          ml_thermal_label_downloaded_at?: string | null
          ml_thermal_label_storage_path?: string | null
          nfe_cfop?: string | null
          nfe_chave?: string | null
          nfe_danfe_url?: string | null
          nfe_external_id?: string | null
          nfe_last_sync_at?: string | null
          nfe_protocolo?: string | null
          nfe_provider?: string | null
          nfe_status?: string | null
          nfe_xml?: string | null
          nota_fiscal_emitida?: boolean
          nota_fiscal_numero?: string | null
          numero: number
          numero_loja?: string | null
          pagamento_resumo?: Json | null
          rastreio?: string | null
          sincronizado_em?: string | null
          situacao?: Database["public"]["Enums"]["pedido_status"]
          snapshot_incompleto?: boolean
          snapshot_pendencias?: Json | null
          snapshot_source?: string | null
          snapshot_version?: number
          totais_snapshot?: Json | null
          total?: number
          updated_at?: string
        }
        Update: {
          billing_documento?: string | null
          billing_endereco?: Json | null
          billing_ie?: string | null
          billing_nome?: string | null
          billing_tipo_pessoa?: string | null
          buyer_ml_id?: string | null
          contato_documento?: string
          contato_nome?: string
          created_at?: string
          data?: string
          data_prevista?: string | null
          data_saida?: string | null
          data_venda?: string | null
          data_venda_source?: string | null
          dslite_etiqueta_enviada?: boolean | null
          dslite_id?: string | null
          dslite_label_source?: string | null
          dslite_status?: string | null
          envio_interno_at?: string | null
          frete?: number
          fulfillment_selected_at?: string | null
          fulfillment_source?: string | null
          id?: string
          lucro?: number
          ml_bundle_parent_item_id?: string | null
          ml_bundle_primary?: boolean | null
          ml_bundle_type?: string | null
          ml_claim_id?: string | null
          ml_claim_status?: string | null
          ml_fiscal_release_at?: string | null
          ml_fiscal_release_checked_at?: string | null
          ml_fiscal_release_reason?: string | null
          ml_fiscal_release_source?: string | null
          ml_invoice_id?: string | null
          ml_invoice_reported?: boolean | null
          ml_label_bytes?: number | null
          ml_label_downloaded_at?: string | null
          ml_label_storage_path?: string | null
          ml_label_url?: string | null
          ml_order_id?: string | null
          ml_pack_id?: string | null
          ml_shipment_id?: string | null
          ml_thermal_label_bytes?: number | null
          ml_thermal_label_downloaded_at?: string | null
          ml_thermal_label_storage_path?: string | null
          nfe_cfop?: string | null
          nfe_chave?: string | null
          nfe_danfe_url?: string | null
          nfe_external_id?: string | null
          nfe_last_sync_at?: string | null
          nfe_protocolo?: string | null
          nfe_provider?: string | null
          nfe_status?: string | null
          nfe_xml?: string | null
          nota_fiscal_emitida?: boolean
          nota_fiscal_numero?: string | null
          numero?: number
          numero_loja?: string | null
          pagamento_resumo?: Json | null
          rastreio?: string | null
          sincronizado_em?: string | null
          situacao?: Database["public"]["Enums"]["pedido_status"]
          snapshot_incompleto?: boolean
          snapshot_pendencias?: Json | null
          snapshot_source?: string | null
          snapshot_version?: number
          totais_snapshot?: Json | null
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      produto_fornecedor_ofertas: {
        Row: {
          ativo: boolean
          cest: string | null
          created_at: string
          custo: number
          descricao: string | null
          dslite_fornecedor_id: string
          dslite_produto_id: string
          estoque: number
          fornecedor_nome: string | null
          gtin: string | null
          id: string
          imagens: Json
          last_sync_at: string | null
          lead_time_dias: number | null
          marca: string | null
          ncm: string | null
          nome: string
          payment_mode: string
          prioridade: number
          produto_id: string
          sku_fornecedor: string | null
          sku_oferta: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cest?: string | null
          created_at?: string
          custo?: number
          descricao?: string | null
          dslite_fornecedor_id: string
          dslite_produto_id: string
          estoque?: number
          fornecedor_nome?: string | null
          gtin?: string | null
          id?: string
          imagens?: Json
          last_sync_at?: string | null
          lead_time_dias?: number | null
          marca?: string | null
          ncm?: string | null
          nome: string
          payment_mode?: string
          prioridade?: number
          produto_id: string
          sku_fornecedor?: string | null
          sku_oferta: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cest?: string | null
          created_at?: string
          custo?: number
          descricao?: string | null
          dslite_fornecedor_id?: string
          dslite_produto_id?: string
          estoque?: number
          fornecedor_nome?: string | null
          gtin?: string | null
          id?: string
          imagens?: Json
          last_sync_at?: string | null
          lead_time_dias?: number | null
          marca?: string | null
          ncm?: string | null
          nome?: string
          payment_mode?: string
          prioridade?: number
          produto_id?: string
          sku_fornecedor?: string | null
          sku_oferta?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_fornecedor_ofertas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_kit_componentes: {
        Row: {
          componente_produto_id: string
          created_at: string
          kit_produto_id: string
          quantidade: number
          updated_at: string
        }
        Insert: {
          componente_produto_id: string
          created_at?: string
          kit_produto_id: string
          quantidade: number
          updated_at?: string
        }
        Update: {
          componente_produto_id?: string
          created_at?: string
          kit_produto_id?: string
          quantidade?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_kit_componentes_componente_produto_id_fkey"
            columns: ["componente_produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_kit_componentes_kit_produto_id_fkey"
            columns: ["kit_produto_id"]
            isOneToOne: false
            referencedRelation: "produto_kits"
            referencedColumns: ["produto_id"]
          },
        ]
      }
      produto_kits: {
        Row: {
          ativo: boolean
          created_at: string
          fornecedor_dslite_id: string
          produto_id: string
          sku_origem: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          fornecedor_dslite_id: string
          produto_id: string
          sku_origem: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          fornecedor_dslite_id?: string
          produto_id?: string
          sku_origem?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_kits_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: true
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          altura: number
          ativo: boolean
          categoria: string | null
          cest: string | null
          created_at: string
          csosn: string | null
          custo: number
          custom_price: number | null
          descricao: string
          dslite_fornecedor_id: string | null
          dslite_produto_id: string | null
          dslite_ultima_sync: string | null
          estoque: number
          fornecedor: string | null
          fornecedor_preferencial_manual: boolean
          gtin: string
          id: string
          imagens: string[]
          largura: number
          marca: string
          ml_fee: number
          ml_item_id: string | null
          ml_shipping: number
          ml_shipping_warning: string | null
          ml_status: Database["public"]["Enums"]["ml_status"]
          ncm: string | null
          nome: string
          oferta_preferencial_id: string | null
          origem_fiscal: string | null
          origem_uf: string | null
          peso_bruto: number
          peso_liq: number
          profundidade: number
          sku: string
          updated_at: string
        }
        Insert: {
          altura?: number
          ativo?: boolean
          categoria?: string | null
          cest?: string | null
          created_at?: string
          csosn?: string | null
          custo?: number
          custom_price?: number | null
          descricao?: string
          dslite_fornecedor_id?: string | null
          dslite_produto_id?: string | null
          dslite_ultima_sync?: string | null
          estoque?: number
          fornecedor?: string | null
          fornecedor_preferencial_manual?: boolean
          gtin?: string
          id?: string
          imagens?: string[]
          largura?: number
          marca?: string
          ml_fee?: number
          ml_item_id?: string | null
          ml_shipping?: number
          ml_shipping_warning?: string | null
          ml_status?: Database["public"]["Enums"]["ml_status"]
          ncm?: string | null
          nome: string
          oferta_preferencial_id?: string | null
          origem_fiscal?: string | null
          origem_uf?: string | null
          peso_bruto?: number
          peso_liq?: number
          profundidade?: number
          sku?: string
          updated_at?: string
        }
        Update: {
          altura?: number
          ativo?: boolean
          categoria?: string | null
          cest?: string | null
          created_at?: string
          csosn?: string | null
          custo?: number
          custom_price?: number | null
          descricao?: string
          dslite_fornecedor_id?: string | null
          dslite_produto_id?: string | null
          dslite_ultima_sync?: string | null
          estoque?: number
          fornecedor?: string | null
          fornecedor_preferencial_manual?: boolean
          gtin?: string
          id?: string
          imagens?: string[]
          largura?: number
          marca?: string
          ml_fee?: number
          ml_item_id?: string | null
          ml_shipping?: number
          ml_shipping_warning?: string | null
          ml_status?: Database["public"]["Enums"]["ml_status"]
          ncm?: string | null
          nome?: string
          oferta_preferencial_id?: string | null
          origem_fiscal?: string | null
          origem_uf?: string | null
          peso_bruto?: number
          peso_liq?: number
          profundidade?: number
          sku?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_oferta_preferencial_id_fkey"
            columns: ["oferta_preferencial_id"]
            isOneToOne: false
            referencedRelation: "produto_fornecedor_ofertas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cargo: Database["public"]["Enums"]["user_role"]
          created_at: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          cargo?: Database["public"]["Enums"]["user_role"]
          created_at?: string
          id: string
          nome: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          cargo?: Database["public"]["Enums"]["user_role"]
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_notification_outbox: {
        Row: {
          attempts: number
          available_at: string
          body: string
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          sent_at: string | null
          status: string
          title: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          body: string
          created_at?: string
          dedupe_key: string
          event_type: string
          id?: string
          last_error?: string | null
          payload?: Json
          sent_at?: string | null
          status?: string
          title: string
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          attempts?: number
          available_at?: string
          body?: string
          created_at?: string
          dedupe_key?: string
          event_type?: string
          id?: string
          last_error?: string | null
          payload?: Json
          sent_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      short_links: {
        Row: {
          code: string
          created_at: string
          expires_at: string | null
          hit_count: number
          last_accessed_at: string | null
          metadata: Json
          purpose: string | null
          target_url: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string | null
          hit_count?: number
          last_accessed_at?: string | null
          metadata?: Json
          purpose?: string | null
          target_url: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string | null
          hit_count?: number
          last_accessed_at?: string | null
          metadata?: Json
          purpose?: string | null
          target_url?: string
        }
        Relationships: []
      }
      supplier_balance_movements: {
        Row: {
          amount: number
          compra_id: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          fornecedor_id: string
          fornecedor_nome: string | null
          id: string
          ml_order_id: string | null
          movement_key: string | null
          movement_type: string
          notes: string | null
          pedido_id: string | null
          reference: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          compra_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          fornecedor_id: string
          fornecedor_nome?: string | null
          id?: string
          ml_order_id?: string | null
          movement_key?: string | null
          movement_type: string
          notes?: string | null
          pedido_id?: string | null
          reference?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          compra_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          fornecedor_id?: string
          fornecedor_nome?: string | null
          id?: string
          ml_order_id?: string | null
          movement_key?: string | null
          movement_type?: string
          notes?: string | null
          pedido_id?: string | null
          reference?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_balance_movements_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_balance_movements_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_balance_movements_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operacionais"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_domain_locks: {
        Row: {
          acquired_at: string
          created_at: string
          domain: string
          expires_at: string
          metadata: Json
          owner_job_id: string | null
          owner_task: string
          owner_token: string
          updated_at: string
        }
        Insert: {
          acquired_at?: string
          created_at?: string
          domain: string
          expires_at: string
          metadata?: Json
          owner_job_id?: string | null
          owner_task: string
          owner_token: string
          updated_at?: string
        }
        Update: {
          acquired_at?: string
          created_at?: string
          domain?: string
          expires_at?: string
          metadata?: Json
          owner_job_id?: string | null
          owner_task?: string
          owner_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_domain_locks_owner_job_id_fkey"
            columns: ["owner_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runtime_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      whatsapp_alert_events: {
        Row: {
          alert_type: string
          created_at: string
          dedupe_key: string
          error: string | null
          id: string
          payload: Json | null
          phone: string
          sent_at: string | null
          status: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          dedupe_key: string
          error?: string | null
          id?: string
          payload?: Json | null
          phone: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          dedupe_key?: string
          error?: string | null
          id?: string
          payload?: Json | null
          phone?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      whatsapp_alert_settings: {
        Row: {
          alert_type: string
          created_at: string
          enabled: boolean
          id: string
          phone: string
          updated_at: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          enabled?: boolean
          id?: string
          phone: string
          updated_at?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          enabled?: boolean
          id?: string
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      pedidos_operacionais: {
        Row: {
          billing_documento: string | null
          billing_endereco: Json | null
          billing_ie: string | null
          billing_nome: string | null
          billing_tipo_pessoa: string | null
          buyer_ml_id: string | null
          contato_documento: string | null
          contato_nome: string | null
          created_at: string | null
          data: string | null
          data_prevista: string | null
          data_saida: string | null
          data_venda: string | null
          data_venda_source: string | null
          dslite_etiqueta_enviada: boolean | null
          dslite_id: string | null
          dslite_label_source: string | null
          dslite_status: string | null
          envio_interno_at: string | null
          frete: number | null
          id: string | null
          lucro: number | null
          ml_bundle_parent_item_id: string | null
          ml_bundle_primary: boolean | null
          ml_bundle_type: string | null
          ml_claim_id: string | null
          ml_claim_status: string | null
          ml_fiscal_release_at: string | null
          ml_fiscal_release_checked_at: string | null
          ml_fiscal_release_reason: string | null
          ml_fiscal_release_source: string | null
          ml_invoice_id: string | null
          ml_invoice_reported: boolean | null
          ml_label_bytes: number | null
          ml_label_downloaded_at: string | null
          ml_label_storage_path: string | null
          ml_label_url: string | null
          ml_order_id: string | null
          ml_pack_id: string | null
          ml_shipment_id: string | null
          ml_thermal_label_bytes: number | null
          ml_thermal_label_downloaded_at: string | null
          ml_thermal_label_storage_path: string | null
          nfe_cfop: string | null
          nfe_chave: string | null
          nfe_danfe_url: string | null
          nfe_external_id: string | null
          nfe_last_sync_at: string | null
          nfe_protocolo: string | null
          nfe_provider: string | null
          nfe_status: string | null
          nfe_xml: string | null
          nota_fiscal_emitida: boolean | null
          nota_fiscal_numero: string | null
          numero: number | null
          numero_loja: string | null
          operational_dslite_ids: string[] | null
          operational_invoice_numbers: string[] | null
          operational_lucro: number | null
          operational_order_ids: string[] | null
          operational_pedido_ids: string[] | null
          operational_profit_pending: boolean | null
          operational_total: number | null
          pagamento_resumo: Json | null
          rastreio: string | null
          sincronizado_em: string | null
          situacao: Database["public"]["Enums"]["pedido_status"] | null
          snapshot_incompleto: boolean | null
          snapshot_pendencias: Json | null
          snapshot_source: string | null
          snapshot_version: number | null
          totais_snapshot: Json | null
          total: number | null
          updated_at: string | null
        }
        Insert: {
          billing_documento?: string | null
          billing_endereco?: Json | null
          billing_ie?: string | null
          billing_nome?: string | null
          billing_tipo_pessoa?: string | null
          buyer_ml_id?: string | null
          contato_documento?: string | null
          contato_nome?: string | null
          created_at?: string | null
          data?: string | null
          data_prevista?: string | null
          data_saida?: string | null
          data_venda?: string | null
          data_venda_source?: string | null
          dslite_etiqueta_enviada?: boolean | null
          dslite_id?: string | null
          dslite_label_source?: string | null
          dslite_status?: string | null
          envio_interno_at?: string | null
          frete?: number | null
          id?: string | null
          lucro?: number | null
          ml_bundle_parent_item_id?: string | null
          ml_bundle_primary?: boolean | null
          ml_bundle_type?: string | null
          ml_claim_id?: string | null
          ml_claim_status?: string | null
          ml_fiscal_release_at?: string | null
          ml_fiscal_release_checked_at?: string | null
          ml_fiscal_release_reason?: string | null
          ml_fiscal_release_source?: string | null
          ml_invoice_id?: string | null
          ml_invoice_reported?: boolean | null
          ml_label_bytes?: number | null
          ml_label_downloaded_at?: string | null
          ml_label_storage_path?: string | null
          ml_label_url?: string | null
          ml_order_id?: string | null
          ml_pack_id?: string | null
          ml_shipment_id?: string | null
          ml_thermal_label_bytes?: number | null
          ml_thermal_label_downloaded_at?: string | null
          ml_thermal_label_storage_path?: string | null
          nfe_cfop?: string | null
          nfe_chave?: string | null
          nfe_danfe_url?: string | null
          nfe_external_id?: string | null
          nfe_last_sync_at?: string | null
          nfe_protocolo?: string | null
          nfe_provider?: string | null
          nfe_status?: string | null
          nfe_xml?: string | null
          nota_fiscal_emitida?: boolean | null
          nota_fiscal_numero?: string | null
          numero?: number | null
          numero_loja?: string | null
          operational_dslite_ids?: never
          operational_invoice_numbers?: never
          operational_lucro?: never
          operational_order_ids?: never
          operational_pedido_ids?: never
          operational_profit_pending?: never
          operational_total?: never
          pagamento_resumo?: Json | null
          rastreio?: string | null
          sincronizado_em?: string | null
          situacao?: Database["public"]["Enums"]["pedido_status"] | null
          snapshot_incompleto?: boolean | null
          snapshot_pendencias?: Json | null
          snapshot_source?: string | null
          snapshot_version?: number | null
          totais_snapshot?: Json | null
          total?: number | null
          updated_at?: string | null
        }
        Update: {
          billing_documento?: string | null
          billing_endereco?: Json | null
          billing_ie?: string | null
          billing_nome?: string | null
          billing_tipo_pessoa?: string | null
          buyer_ml_id?: string | null
          contato_documento?: string | null
          contato_nome?: string | null
          created_at?: string | null
          data?: string | null
          data_prevista?: string | null
          data_saida?: string | null
          data_venda?: string | null
          data_venda_source?: string | null
          dslite_etiqueta_enviada?: boolean | null
          dslite_id?: string | null
          dslite_label_source?: string | null
          dslite_status?: string | null
          envio_interno_at?: string | null
          frete?: number | null
          id?: string | null
          lucro?: number | null
          ml_bundle_parent_item_id?: string | null
          ml_bundle_primary?: boolean | null
          ml_bundle_type?: string | null
          ml_claim_id?: string | null
          ml_claim_status?: string | null
          ml_fiscal_release_at?: string | null
          ml_fiscal_release_checked_at?: string | null
          ml_fiscal_release_reason?: string | null
          ml_fiscal_release_source?: string | null
          ml_invoice_id?: string | null
          ml_invoice_reported?: boolean | null
          ml_label_bytes?: number | null
          ml_label_downloaded_at?: string | null
          ml_label_storage_path?: string | null
          ml_label_url?: string | null
          ml_order_id?: string | null
          ml_pack_id?: string | null
          ml_shipment_id?: string | null
          ml_thermal_label_bytes?: number | null
          ml_thermal_label_downloaded_at?: string | null
          ml_thermal_label_storage_path?: string | null
          nfe_cfop?: string | null
          nfe_chave?: string | null
          nfe_danfe_url?: string | null
          nfe_external_id?: string | null
          nfe_last_sync_at?: string | null
          nfe_protocolo?: string | null
          nfe_provider?: string | null
          nfe_status?: string | null
          nfe_xml?: string | null
          nota_fiscal_emitida?: boolean | null
          nota_fiscal_numero?: string | null
          numero?: number | null
          numero_loja?: string | null
          operational_dslite_ids?: never
          operational_invoice_numbers?: never
          operational_lucro?: never
          operational_order_ids?: never
          operational_pedido_ids?: never
          operational_profit_pending?: never
          operational_total?: never
          pagamento_resumo?: Json | null
          rastreio?: string | null
          sincronizado_em?: string | null
          situacao?: Database["public"]["Enums"]["pedido_status"] | null
          snapshot_incompleto?: boolean | null
          snapshot_pendencias?: Json | null
          snapshot_source?: string | null
          snapshot_version?: number | null
          totais_snapshot?: Json | null
          total?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_integracao_refresh_lock: {
        Args: {
          p_owner: string
          p_tipo: Database["public"]["Enums"]["integracao_tipo"]
          p_ttl_seconds?: number
        }
        Returns: boolean
      }
      acquire_sync_domain_lock: {
        Args: {
          p_domain: string
          p_metadata?: Json
          p_owner_job_id?: string
          p_owner_task: string
          p_owner_token: string
          p_ttl_seconds?: number
        }
        Returns: boolean
      }
      dispatch_sync_cron: { Args: never; Returns: undefined }
      get_fornecedores: {
        Args: never
        Returns: {
          fornecedor: string
        }[]
      }
      match_dataset_vortek: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          category: string
          is_vortek: boolean
          question: string
          reasoning: string
          response: string
          similarity: number
          vortek_files: string[]
        }[]
      }
      match_documentacao_vortek: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          conteudo: string
          fonte: string
          secao: string
          similarity: number
          titulo: string
          url: string
        }[]
      }
      next_vortek_product_sku: { Args: never; Returns: string }
      release_integracao_refresh_lock: {
        Args: {
          p_owner: string
          p_tipo: Database["public"]["Enums"]["integracao_tipo"]
        }
        Returns: boolean
      }
      release_sync_domain_lock: {
        Args: { p_domain: string; p_force?: boolean; p_owner_token: string }
        Returns: boolean
      }
      search_pedidos_paginated: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_page?: number
          p_page_size?: number
          p_price_max?: number
          p_price_min?: number
          p_search?: string
          p_sort_by?: string
          p_sort_order?: string
          p_status?: Database["public"]["Enums"]["pedido_status"]
        }
        Returns: Json
      }
      search_pedidos_resumo: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_price_max?: number
          p_price_min?: number
          p_search?: string
          p_status?: Database["public"]["Enums"]["pedido_status"]
        }
        Returns: {
          count: number
          lucro_sum: number
          margem: number
          ml_compatible_count: number
          ml_compatible_missing_payment_data: number
          ml_compatible_total: number
          status_counts: Json
          ticket: number
          total: number
        }[]
      }
      search_produtos_paginated: {
        Args: {
          p_estoque?: string
          p_include_internal?: boolean
          p_ml_status?: string
          p_page?: number
          p_page_size?: number
          p_price_field?: string
          p_price_max?: number
          p_price_min?: number
          p_product_active_status?: string
          p_search?: string
          p_sort_by?: string
          p_sort_order?: string
          p_supplier_dslite_ids?: string[]
        }
        Returns: Json
      }
      search_produtos_resumo: {
        Args: {
          p_estoque?: string
          p_include_internal?: boolean
          p_ml_status?: string
          p_price_field?: string
          p_price_max?: number
          p_price_min?: number
          p_product_active_status?: string
          p_search?: string
          p_supplier_dslite_ids?: string[]
        }
        Returns: Json
      }
      select_order_fulfillment: {
        Args: { p_pedido_id: string; p_source: string }
        Returns: {
          fulfillment_selected_at: string
          fulfillment_source: string
          selected_now: boolean
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      integracao_tipo:
        | "mercadolivre"
        | "bling"
        | "dslite"
        | "brasilnfe"
        | "mercadopago"
      ml_status: "ativo" | "pausado" | "sem_anuncio"
      pedido_status:
        | "aberto"
        | "atendido"
        | "cancelado"
        | "faturado"
        | "entregue"
        | "pendente"
        | "preparando"
        | "etiqueta_impressa"
        | "coletado"
        | "em_transito"
        | "saiu_entrega"
        | "dest_ausente"
        | "recusado"
        | "devolvido"
        | "pronto_envio"
      user_role: "admin" | "gerente" | "operador" | "visualizador"
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
      integracao_tipo: [
        "mercadolivre",
        "bling",
        "dslite",
        "brasilnfe",
        "mercadopago",
      ],
      ml_status: ["ativo", "pausado", "sem_anuncio"],
      pedido_status: [
        "aberto",
        "atendido",
        "cancelado",
        "faturado",
        "entregue",
        "pendente",
        "preparando",
        "etiqueta_impressa",
        "coletado",
        "em_transito",
        "saiu_entrega",
        "dest_ausente",
        "recusado",
        "devolvido",
        "pronto_envio",
      ],
      user_role: ["admin", "gerente", "operador", "visualizador"],
    },
  },
} as const
