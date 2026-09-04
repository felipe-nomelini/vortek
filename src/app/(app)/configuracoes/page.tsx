"use client";

import { Suspense, useEffect, useState } from "react";
import { Card, Spin, Tabs, Typography, message } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import { useSearchParams } from "next/navigation";
import EmpresaTab from "@/components/configuracoes/EmpresaTab";
import IntegracoesTab from "@/components/configuracoes/IntegracoesTab";
import PreferenciasTab from "@/components/configuracoes/PreferenciasTab";
import UsuariosTab from "@/components/configuracoes/UsuariosTab";
import AuditoriaTab from "@/components/configuracoes/AuditoriaTab";
import ComercialTab from "@/components/configuracoes/ComercialTab";
import { configuracoesCardStyle } from "@/components/configuracoes/styles";

const { Title } = Typography;
const validTabs = ["empresa", "comercial", "integracoes", "usuarios", "preferencias", "historico"];

function ConfiguracoesPageContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("empresa");
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    const requestedTab = searchParams?.get("tab");
    if (requestedTab && validTabs.includes(requestedTab)) {
      setTab(requestedTab);
    }
  }, [searchParams]);

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: "#e0e0e0", marginBottom: 20 }}>
        Configurações
      </Title>
      <Card
        styles={{ body: { padding: 0 } }}
        style={{ ...configuracoesCardStyle, overflow: "hidden" }}
      >
        <Tabs
          activeKey={tab}
          onChange={setTab}
          tabBarStyle={{
            margin: 0,
            paddingLeft: 16,
            background: "#1a1a1a",
            borderBottom: "1px solid #303030",
          }}
          style={{ padding: 20 }}
          items={[
            {
              key: "empresa",
              label: "🏢 Empresa e fiscal",
              forceRender: true,
              children: <EmpresaTab messageApi={messageApi} />,
            },
            {
              key: "comercial",
              label: "💰 Comercial",
              forceRender: true,
              children: <ComercialTab messageApi={messageApi} />,
            },
            {
              key: "integracoes",
              label: "🔐 Integrações",
              forceRender: true,
              children: <IntegracoesTab messageApi={messageApi} />,
            },
            {
              key: "usuarios",
              label: "👥 Usuários",
              forceRender: true,
              children: <UsuariosTab messageApi={messageApi} />,
            },
            {
              key: "preferencias",
              label: "⚙️ Preferências",
              forceRender: true,
              children: <PreferenciasTab messageApi={messageApi} />,
            },
            {
              key: "historico",
              label: "🕘 Histórico",
              children: <AuditoriaTab messageApi={messageApi} />,
            },
          ]}
        />
      </Card>
    </div>
  );
}

export default function ConfiguracoesPage() {
  return (
    <Suspense
      fallback={
        <div>
          <Card style={configuracoesCardStyle}>
            <Spin
              spinning
              indicator={
                <LoadingOutlined
                  style={{ fontSize: 24, color: "#1677ff" }}
                  spin
                />
              }
            />
          </Card>
        </div>
      }
    >
      <ConfiguracoesPageContent />
    </Suspense>
  );
}
