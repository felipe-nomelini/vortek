'use client';

import { Modal, Progress, Tag, Typography, Divider } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, BulbFilled } from '@ant-design/icons';

const { Text } = Typography;

interface QualidadeItem {
  nome: string;
  ok: boolean;
  pontos: number;
  max: number;
}

interface QualidadeModalProps {
  open: boolean;
  onClose: () => void;
  score: number;
  itens: QualidadeItem[];
  dica?: string;
  titulo: string;
}

export default function QualidadeModal({ open, onClose, score, itens, dica, titulo }: QualidadeModalProps) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={<span style={{ color: '#e0e0e0' }}>📊 Qualidade do Anúncio</span>}
      width={480}
      styles={{ body: { padding: 20 } }}
    >
      <div style={{ color: '#a0a0a0', fontSize: 13, marginBottom: 16 }}>{titulo}</div>

      <div style={{ marginBottom: 20 }}>
        <Progress
          percent={score}
          strokeColor={score >= 80 ? '#52c41a' : score >= 50 ? '#faad14' : '#ff4d4f'}
          trailColor="#303030"
          format={() => `${score}%`}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {itens.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', borderRadius: 6,
              background: item.ok ? '#162812' : '#2a0d0e',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {item.ok
                ? <CheckCircleFilled style={{ color: '#52c41a', fontSize: 16 }} />
                : <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 16 }} />
              }
              <Text style={{ color: '#c0c0c0', fontSize: 13 }}>{item.nome}</Text>
            </div>
            <Text style={{ color: item.ok ? '#52c41a' : '#ff4d4f', fontWeight: 600, fontSize: 13 }}>
              {item.pontos}/{item.max}
            </Text>
          </div>
        ))}
      </div>

      <Divider style={{ borderColor: '#303030', margin: '12px 0' }} />

      {dica && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderRadius: 6, background: '#1a1a2e' }}>
          <BulbFilled style={{ color: '#faad14', fontSize: 16, flexShrink: 0, marginTop: 1 }} />
          <Text style={{ color: '#c0c0c0', fontSize: 13 }}>{dica}</Text>
        </div>
      )}
    </Modal>
  );
}
