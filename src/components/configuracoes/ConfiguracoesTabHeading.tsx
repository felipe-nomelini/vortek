"use client";

import { Typography } from "antd";
import { benteviColors } from "@/theme/bentevi";

type Props = { title: string; description: string };

export default function ConfiguracoesTabHeading({ title, description }: Props) {
  return (
    <div data-configuracoes-heading style={{ minWidth: 0 }}>
      <Typography.Title level={4} style={{
        margin: "0 0 6px", fontSize: 20, fontWeight: 600,
        lineHeight: "28px", color: benteviColors.text,
      }}>
        {title}
      </Typography.Title>
      <Typography.Text style={{
        display: "block", fontSize: 14, lineHeight: "22px",
        color: benteviColors.textSecondary,
      }}>
        {description}
      </Typography.Text>
    </div>
  );
}
