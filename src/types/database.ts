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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      anuncios_ml: {
        Row: {
          catalogo: boolean
          created_at: string
          id: string
          ml_sync_block_reason: string | null
          ml_sync_blocked_until: string | null
          ml_sync_last_error: string | null
          ml_item_id: string
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
          ml_sync_block_reason?: string | null
          ml_sync_blocked_until?: string | null
          ml_sync_last_error?: string | null
          ml_item_id: string
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
          ml_sync_block_reason?: string | null
          ml_sync_blocked_until?: string | null
          ml_sync_last_error?: string | null
          ml_item_id?: string
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
      configuracoes: {
        Row: {
          created_at: string
          id: string
          margem_lucro: number
          nfe_provider_default: string
          notificacoes_email: boolean
          notificacoes_push: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          margem_lucro?: number
          nfe_provider_default?: string
          notificacoes_email?: boolean
          notificacoes_push?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          margem_lucro?: number
          nfe_provider_default?: string
          notificacoes_email?: boolean
          notificacoes_push?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      empresa: {
        Row: {
          cod_municipio_fiscal: string | null
          cnpj: string
          created_at: string
          email: string
          endereco: string
          id: string
          nickname: string
          nome: string
          telefone: string
          uf_fiscal: string | null
          updated_at: string
        }
        Insert: {
          cod_municipio_fiscal?: string | null
          cnpj?: string
          created_at?: string
          email?: string
          endereco?: string
          id?: string
          nickname?: string
          nome?: string
          telefone?: string
          uf_fiscal?: string | null
          updated_at?: string
        }
        Update: {
          cod_municipio_fiscal?: string | null
          cnpj?: string
          created_at?: string
          email?: string
          endereco?: string
          id?: string
          nickname?: string
          nome?: string
          telefone?: string
          uf_fiscal?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fornecedores: {
        Row: {
          ativo: boolean
          apelido: string
          cnpj: string
          created_at: string
          dslite_id: string | null
          dslite_ultima_sync: string | null
          dropshipping: string
          email: string
          endereco: string
          id: string
          nome: string
          payload_dslite: Json
          status_dslite: string
          supplier_pix_key: string
          telefone: string
          crossdocking: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          apelido?: string
          cnpj?: string
          created_at?: string
          dslite_id?: string | null
          dslite_ultima_sync?: string | null
          dropshipping?: string
          email?: string
          endereco?: string
          id?: string
          nome: string
          payload_dslite?: Json
          status_dslite?: string
          supplier_pix_key?: string
          telefone?: string
          crossdocking?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          apelido?: string
          cnpj?: string
          created_at?: string
          dslite_id?: string | null
          dslite_ultima_sync?: string | null
          dropshipping?: string
          email?: string
          endereco?: string
          id?: string
          nome?: string
          payload_dslite?: Json
          status_dslite?: string
          supplier_pix_key?: string
          telefone?: string
          crossdocking?: string
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
      jobs: {
        Row: {
          cancelado: boolean
          created_at: string
          created_by: string | null
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
          data_venda: string | null
          data_venda_source: string | null
          data_prevista: string | null
          data_saida: string | null
          dslite_id: string | null
          dslite_status: string | null
          dslite_etiqueta_enviada: boolean
          frete: number
          id: string
          lucro: number
          ml_claim_id: string | null
          ml_claim_status: string | null
          ml_invoice_id: string | null
          ml_invoice_reported: boolean
          ml_order_id: string | null
          ml_pack_id: string | null
          ml_fiscal_release_at: string | null
          ml_fiscal_release_reason: string | null
          ml_fiscal_release_source: string | null
          ml_fiscal_release_checked_at: string | null
          ml_label_bytes: number | null
          ml_label_downloaded_at: string | null
          ml_label_storage_path: string | null
          ml_label_url: string | null
          ml_shipment_id: string | null
          nfe_chave: string | null
          nfe_cfop: string | null
          nfe_danfe_url: string | null
          nfe_external_id: string | null
          nfe_last_sync_at: string | null
          nfe_provider: string | null
          nfe_protocolo: string | null
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
          data_venda?: string | null
          data_venda_source?: string | null
          data_prevista?: string | null
          data_saida?: string | null
          dslite_id?: string | null
          dslite_status?: string | null
          dslite_etiqueta_enviada?: boolean
          frete?: number
          id?: string
          lucro?: number
          ml_claim_id?: string | null
          ml_claim_status?: string | null
          ml_invoice_id?: string | null
          ml_invoice_reported?: boolean
          ml_order_id?: string | null
          ml_pack_id?: string | null
          ml_fiscal_release_at?: string | null
          ml_fiscal_release_reason?: string | null
          ml_fiscal_release_source?: string | null
          ml_fiscal_release_checked_at?: string | null
          ml_label_bytes?: number | null
          ml_label_downloaded_at?: string | null
          ml_label_storage_path?: string | null
          ml_label_url?: string | null
          ml_shipment_id?: string | null
          nfe_chave?: string | null
          nfe_cfop?: string | null
          nfe_danfe_url?: string | null
          nfe_external_id?: string | null
          nfe_last_sync_at?: string | null
          nfe_provider?: string | null
          nfe_protocolo?: string | null
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
          data_venda?: string | null
          data_venda_source?: string | null
          data_prevista?: string | null
          data_saida?: string | null
          dslite_id?: string | null
          dslite_status?: string | null
          dslite_etiqueta_enviada?: boolean
          frete?: number
          id?: string
          lucro?: number
          ml_claim_id?: string | null
          ml_claim_status?: string | null
          ml_invoice_id?: string | null
          ml_invoice_reported?: boolean
          ml_order_id?: string | null
          ml_pack_id?: string | null
          ml_fiscal_release_at?: string | null
          ml_fiscal_release_reason?: string | null
          ml_fiscal_release_source?: string | null
          ml_fiscal_release_checked_at?: string | null
          ml_label_bytes?: number | null
          ml_label_downloaded_at?: string | null
          ml_label_storage_path?: string | null
          ml_label_url?: string | null
          ml_shipment_id?: string | null
          nfe_chave?: string | null
          nfe_cfop?: string | null
          nfe_danfe_url?: string | null
          nfe_external_id?: string | null
          nfe_last_sync_at?: string | null
          nfe_provider?: string | null
          nfe_protocolo?: string | null
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
        ]
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
        ]
      }
      compras: {
        Row: {
          id: string
          dsid: string
          status: string
          status_dslite: string
          nf_chave: string | null
          nf_numero: string | null
          nf_serie: string | null
          valor_total: number
          valor_frete: number
          data_criacao: string
          rastreio: string | null
          fornecedor_id: string | null
          fornecedor_nome: string | null
          destinatario_nome: string | null
          destinatario_documento: string | null
          produto_descricao: string | null
          produto_fornecedor_oferta_id: string | null
          produto_sku: string | null
          quantidade: number
          supplier_payment_amount: number | null
          supplier_payment_confirmed_at: string | null
          supplier_payment_confirmed_by: string | null
          supplier_payment_mode: string | null
          supplier_payment_notes: string | null
          supplier_payment_receipt_path: string | null
          supplier_payment_receipt_url: string | null
          supplier_payment_reference: string | null
          supplier_payment_status: string | null
          created_at: string
        }
        Insert: {
          id?: string
          dsid: string
          status?: string
          status_dslite?: string
          nf_chave?: string | null
          nf_numero?: string | null
          nf_serie?: string | null
          valor_total?: number
          valor_frete?: number
          data_criacao?: string
          rastreio?: string | null
          fornecedor_id?: string | null
          fornecedor_nome?: string | null
          destinatario_nome?: string | null
          destinatario_documento?: string | null
          produto_descricao?: string | null
          produto_fornecedor_oferta_id?: string | null
          produto_sku?: string | null
          quantidade?: number
          supplier_payment_amount?: number | null
          supplier_payment_confirmed_at?: string | null
          supplier_payment_confirmed_by?: string | null
          supplier_payment_mode?: string | null
          supplier_payment_notes?: string | null
          supplier_payment_receipt_path?: string | null
          supplier_payment_receipt_url?: string | null
          supplier_payment_reference?: string | null
          supplier_payment_status?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          dsid?: string
          status?: string
          status_dslite?: string
          nf_chave?: string | null
          nf_numero?: string | null
          nf_serie?: string | null
          valor_total?: number
          valor_frete?: number
          data_criacao?: string
          rastreio?: string | null
          fornecedor_id?: string | null
          fornecedor_nome?: string | null
          destinatario_nome?: string | null
          destinatario_documento?: string | null
          produto_descricao?: string | null
          produto_fornecedor_oferta_id?: string | null
          produto_sku?: string | null
          quantidade?: number
          supplier_payment_amount?: number | null
          supplier_payment_confirmed_at?: string | null
          supplier_payment_confirmed_by?: string | null
          supplier_payment_mode?: string | null
          supplier_payment_notes?: string | null
          supplier_payment_receipt_path?: string | null
          supplier_payment_receipt_url?: string | null
          supplier_payment_reference?: string | null
          supplier_payment_status?: string | null
          created_at?: string
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
      produto_fornecedor_ofertas: {
        Row: {
          ativo: boolean
          cest: string | null
          created_at: string
          custo: number
          descricao: string
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
          nome: string
          ncm: string | null
          payment_mode: string
          prioridade: number
          produto_id: string
          sku_oferta: string
          sku_fornecedor: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cest?: string | null
          created_at?: string
          custo?: number
          descricao?: string
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
          nome: string
          ncm?: string | null
          payment_mode?: string
          prioridade?: number
          produto_id: string
          sku_oferta: string
          sku_fornecedor?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cest?: string | null
          created_at?: string
          custo?: number
          descricao?: string
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
          nome?: string
          ncm?: string | null
          payment_mode?: string
          prioridade?: number
          produto_id?: string
          sku_oferta?: string
          sku_fornecedor?: string | null
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
      mercadopago_account_movements: {
        Row: {
          id: string
          external_id: string
          movement_date: string | null
          description: string | null
          reference: string | null
          amount: number
          movement_type: string | null
          currency: string | null
          raw_payload: Json
          matched_supplier: string | null
          supplier_balance_movement_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          external_id: string
          movement_date?: string | null
          description?: string | null
          reference?: string | null
          amount?: number
          movement_type?: string | null
          currency?: string | null
          raw_payload?: Json
          matched_supplier?: string | null
          supplier_balance_movement_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          external_id?: string
          movement_date?: string | null
          description?: string | null
          reference?: string | null
          amount?: number
          movement_type?: string | null
          currency?: string | null
          raw_payload?: Json
          matched_supplier?: string | null
          supplier_balance_movement_id?: string | null
          created_at?: string
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
      supplier_balance_movements: {
        Row: {
          id: string
          fornecedor_id: string
          fornecedor_nome: string | null
          movement_type: string
          amount: number
          reference: string | null
          compra_id: string | null
          notes: string | null
          created_by: string | null
          movement_key: string | null
          created_at: string
        }
        Insert: {
          id?: string
          fornecedor_id: string
          fornecedor_nome?: string | null
          movement_type: string
          amount: number
          reference?: string | null
          compra_id?: string | null
          notes?: string | null
          created_by?: string | null
          movement_key?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          fornecedor_id?: string
          fornecedor_nome?: string | null
          movement_type?: string
          amount?: number
          reference?: string | null
          compra_id?: string | null
          notes?: string | null
          created_by?: string | null
          movement_key?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_balance_movements_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          ativo: boolean
          altura: number
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
          ativo?: boolean
          altura?: number
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
          sku: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          altura?: number
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      search_produtos_paginated: {
        Args: {
          p_search?: string | null
          p_supplier_dslite_ids?: string[] | null
          p_product_active_status?: string | null
          p_ml_status?: string | null
          p_estoque?: string | null
          p_price_min?: number | null
          p_price_max?: number | null
          p_price_field?: string | null
          p_page?: number | null
          p_page_size?: number | null
          p_sort_by?: string | null
          p_sort_order?: string | null
        }
        Returns: Json
      }
      search_produtos_resumo: {
        Args: {
          p_search?: string | null
          p_supplier_dslite_ids?: string[] | null
          p_product_active_status?: string | null
          p_ml_status?: string | null
          p_estoque?: string | null
          p_price_min?: number | null
          p_price_max?: number | null
          p_price_field?: string | null
        }
        Returns: Json
      }
    }
    Enums: {
      integracao_tipo: "mercadolivre" | "bling" | "dslite" | "brasilnfe" | "mercadopago"
      ml_status: "ativo" | "pausado" | "sem_anuncio"
      pedido_status:
        | "aberto"
        | "atendido"
        | "cancelado"
        | "faturado"
        | "entregue"
        | "pendente"
        | "preparando"
        | "pronto_envio"
        | "etiqueta_impressa"
        | "coletado"
        | "em_transito"
        | "saiu_entrega"
        | "dest_ausente"
        | "recusado"
        | "devolvido"
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
      integracao_tipo: ["mercadolivre", "bling", "dslite", "brasilnfe"],
      ml_status: ["ativo", "pausado", "sem_anuncio"],
      pedido_status: [
        "aberto",
        "atendido",
        "cancelado",
        "faturado",
        "entregue",
        "pendente",
        "preparando",
        "pronto_envio",
        "etiqueta_impressa",
        "coletado",
        "em_transito",
        "saiu_entrega",
        "dest_ausente",
        "recusado",
        "devolvido",
      ],
      user_role: ["admin", "gerente", "operador", "visualizador"],
    },
  },
} as const
