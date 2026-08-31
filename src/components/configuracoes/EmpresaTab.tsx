"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Col, Input, Row, Spin } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { configuracoesInputStyle } from "./styles";

interface EmpresaState {
  nome: string;
  nickname: string;
  cnpj: string;
  endereco: string;
  email: string;
  telefone: string;
  uf_fiscal: string;
  cod_municipio_fiscal: string;
}

const emptyEmpresa: EmpresaState = {
  nome: "",
  nickname: "",
  cnpj: "",
  endereco: "",
  email: "",
  telefone: "",
  uf_fiscal: "",
  cod_municipio_fiscal: "",
};

export default function EmpresaTab({
  messageApi,
}: {
  messageApi: MessageInstance;
}) {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState<EmpresaState>(emptyEmpresa);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/configuracoes/empresa");
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          messageApi.error(data?.erro || "Falha ao carregar dados da empresa");
          return;
        }
        if (!data) return;
        setEmpresaId(data.id || null);
        setEmpresa({
          nome: data.nome || "",
          nickname: data.nickname || "",
          cnpj: data.cnpj || "",
          endereco: data.endereco || "",
          email: data.email || "",
          telefone: data.telefone || "",
          uf_fiscal: data.uf_fiscal || "",
          cod_municipio_fiscal: data.cod_municipio_fiscal || "",
        });
      } catch {
        messageApi.error("Falha ao carregar dados da empresa");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [messageApi]);

  const patchEmpresa = (data: Partial<EmpresaState>) =>
    setEmpresa((current) => ({ ...current, ...data }));

  const salvarEmpresa = useCallback(async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/configuracoes/empresa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: empresaId, ...empresa }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(data?.erro || "Falha ao salvar dados da empresa");
        return;
      }
      if (data?.id) setEmpresaId(data.id);
      messageApi.success("Dados da empresa salvos");
    } catch {
      messageApi.error("Falha ao salvar dados da empresa");
    } finally {
      setSaving(false);
    }
  }, [empresa, empresaId, messageApi]);

  return (
    <Spin spinning={loading}>
      <Row gutter={[16, 12]}>
        <Col span={12}>
          <div style={{ color: "#a0a0a0", fontSize: 13 }}>Nome da Loja</div>
          <Input
            value={empresa.nome}
            onChange={(event) => patchEmpresa({ nome: event.target.value })}
            style={configuracoesInputStyle}
          />
        </Col>
        <Col span={12}>
          <div style={{ color: "#a0a0a0", fontSize: 13 }}>Nickname ML</div>
          <Input
            value={empresa.nickname}
            onChange={(event) => patchEmpresa({ nickname: event.target.value })}
            style={configuracoesInputStyle}
          />
        </Col>
        <Col span={12}>
          <div style={{ color: "#a0a0a0", fontSize: 13 }}>CNPJ</div>
          <Input
            value={empresa.cnpj}
            onChange={(event) => patchEmpresa({ cnpj: event.target.value })}
            style={configuracoesInputStyle}
          />
        </Col>
        <Col span={12}>
          <div style={{ color: "#a0a0a0", fontSize: 13 }}>Telefone</div>
          <Input
            value={empresa.telefone}
            onChange={(event) => patchEmpresa({ telefone: event.target.value })}
            style={configuracoesInputStyle}
          />
        </Col>
        <Col span={12}>
          <div style={{ color: "#a0a0a0", fontSize: 13 }}>UF Fiscal</div>
          <Input
            maxLength={2}
            value={empresa.uf_fiscal}
            onChange={(event) =>
              patchEmpresa({ uf_fiscal: event.target.value.toUpperCase() })
            }
            style={configuracoesInputStyle}
          />
        </Col>
        <Col span={12}>
          <div style={{ color: "#a0a0a0", fontSize: 13 }}>
            Código Município (IBGE)
          </div>
          <Input
            maxLength={7}
            value={empresa.cod_municipio_fiscal}
            onChange={(event) =>
              patchEmpresa({
                cod_municipio_fiscal: event.target.value.replace(/\D/g, ""),
              })
            }
            style={configuracoesInputStyle}
          />
        </Col>
        <Col span={12}>
          <div style={{ color: "#a0a0a0", fontSize: 13 }}>E-mail</div>
          <Input
            value={empresa.email}
            onChange={(event) => patchEmpresa({ email: event.target.value })}
            style={configuracoesInputStyle}
          />
        </Col>
        <Col span={24}>
          <div style={{ color: "#a0a0a0", fontSize: 13 }}>Endereço</div>
          <Input
            value={empresa.endereco}
            onChange={(event) => patchEmpresa({ endereco: event.target.value })}
            style={configuracoesInputStyle}
          />
        </Col>
        <Col span={24}>
          <Button
            type="primary"
            size="small"
            loading={saving}
            onClick={salvarEmpresa}
          >
            Salvar dados da empresa
          </Button>
        </Col>
      </Row>
    </Spin>
  );
}
