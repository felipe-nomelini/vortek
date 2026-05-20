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
          notificacoes_email: boolean
          notificacoes_push: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          margem_lucro?: number
          notificacoes_email?: boolean
          notificacoes_push?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          margem_lucro?: number
          notificacoes_email?: boolean
          notificacoes_push?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      empresa: {
        Row: {
          cnpj: string
          created_at: string
          email: string
          endereco: string
          id: string
          nickname: string
          nome: string
          telefone: string
          updated_at: string
        }
        Insert: {
          cnpj?: string
          created_at?: string
          email?: string
          endereco?: string
          id?: string
          nickname?: string
          nome?: string
          telefone?: string
          updated_at?: string
        }
        Update: {
          cnpj?: string
          created_at?: string
          email?: string
          endereco?: string
          id?: string
          nickname?: string
          nome?: string
          telefone?: string
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
          contato_documento: string
          contato_nome: string
          created_at: string
          data: string
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
          ml_shipment_id: string | null
          nfe_chave: string | null
          nfe_danfe_url: string | null
          nfe_protocolo: string | null
          nfe_status: string | null
          nfe_xml: string | null
          nota_fiscal_emitida: boolean
          nota_fiscal_numero: string | null
          numero: number
          numero_loja: string | null
          rastreio: string | null
          situacao: Database["public"]["Enums"]["pedido_status"]
          total: number
          updated_at: string
        }
        Insert: {
          contato_documento?: string
          contato_nome: string
          created_at?: string
          data?: string
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
          ml_shipment_id?: string | null
          nfe_chave?: string | null
          nfe_danfe_url?: string | null
          nfe_protocolo?: string | null
          nfe_status?: string | null
          nfe_xml?: string | null
          nota_fiscal_emitida?: boolean
          nota_fiscal_numero?: string | null
          numero: number
          numero_loja?: string | null
          rastreio?: string | null
          situacao?: Database["public"]["Enums"]["pedido_status"]
          total?: number
          updated_at?: string
        }
        Update: {
          contato_documento?: string
          contato_nome?: string
          created_at?: string
          data?: string
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
          ml_shipment_id?: string | null
          nfe_chave?: string | null
          nfe_danfe_url?: string | null
          nfe_protocolo?: string | null
          nfe_status?: string | null
          nfe_xml?: string | null
          nota_fiscal_emitida?: boolean
          nota_fiscal_numero?: string | null
          numero?: number
          numero_loja?: string | null
          rastreio?: string | null
          situacao?: Database["public"]["Enums"]["pedido_status"]
          total?: number
          updated_at?: string
        }
        Relationships: []
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
          produto_sku: string | null
          quantidade: number
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
          produto_sku?: string | null
          quantidade?: number
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
          produto_sku?: string | null
          quantidade?: number
          created_at?: string
        }
        Relationships: []
      }
      produtos: {
        Row: {
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
          origem_fiscal?: string | null
          origem_uf?: string | null
          peso_bruto?: number
          peso_liq?: number
          profundidade?: number
          sku: string
          updated_at?: string
        }
        Update: {
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
          origem_fiscal?: string | null
          origem_uf?: string | null
          peso_bruto?: number
          peso_liq?: number
          profundidade?: number
          sku?: string
          updated_at?: string
        }
        Relationships: []
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
    }
    Enums: {
      integracao_tipo: "mercadolivre" | "bling" | "dslite"
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
      integracao_tipo: ["mercadolivre", "bling", "dslite"],
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
