'use client';

import { Modal, Steps, Typography, Button, Space, Badge } from 'antd';
import { LoadingOutlined, CheckCircleFilled, CloseCircleFilled, ClockCircleOutlined, ExclamationCircleFilled } from '@ant-design/icons';

const { Text } = Typography;

export type StepStatus = 'pending' | 'loading' | 'success' | 'error' | 'warning';

export interface ProgressStep {
  label: string;
  status: StepStatus;
  error?: string;
  detail?: string;
}

interface ProgressModalProps {
  open: boolean;
  title: string;
  steps: ProgressStep[];
  onClose: () => void;
  onCancel?: () => void;
  showCloseButton?: boolean;
  customActions?: Array<{
    key: string;
    label: string;
    onClick: () => void;
    danger?: boolean;
    primary?: boolean;
  }>;
}

const statusConfig: Record<StepStatus, { icon: React.ReactNode; color: string; badge: string }> = {
  pending: { icon: <ClockCircleOutlined />, color: '#666', badge: 'default' },
  loading: { icon: <LoadingOutlined spin style={{ color: '#1677ff' }} />, color: '#1677ff', badge: 'processing' },
  success: { icon: <CheckCircleFilled style={{ color: '#52c41a', fontSize: 18 }} />, color: '#52c41a', badge: 'success' },
  error: { icon: <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 18 }} />, color: '#ff4d4f', badge: 'error' },
  warning: { icon: <ExclamationCircleFilled style={{ color: '#faad14', fontSize: 18 }} />, color: '#faad14', badge: 'warning' },
};

const currentStepIndex = (steps: ProgressStep[]): number => {
  const idx = steps.findIndex(s => s.status === 'loading' || s.status === 'error');
  if (idx === -1) {
    const completedCount = steps.filter(s => s.status === 'success' || s.status === 'warning').length;
    return completedCount < steps.length ? completedCount : steps.length - 1;
  }
  return idx;
};

export default function ProgressModal({
  open,
  title,
  steps,
  onClose,
  onCancel,
  showCloseButton = false,
  customActions = [],
}: ProgressModalProps) {
  const current = currentStepIndex(steps);
  const hasError = steps.some(s => s.status === 'error');
  const allDone = steps.every(s => s.status === 'success' || s.status === 'warning');
  const currentLoading = steps.find(s => s.status === 'loading');

  return (
    <Modal
      open={open}
      title={
        <Space>
          <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{title}</span>
          {currentLoading && (
            <Badge status="processing" text={<Text style={{ color: '#1677ff', fontSize: 12 }}>Em andamento...</Text>} />
          )}
          {allDone && (
            <Badge status="success" text={<Text style={{ color: '#52c41a', fontSize: 12 }}>Concluído!</Text>} />
          )}
          {hasError && (
            <Badge status="error" text={<Text style={{ color: '#ff4d4f', fontSize: 12 }}>Erro</Text>} />
          )}
        </Space>
      }
      footer={null}
      closable={showCloseButton || allDone || hasError}
      onCancel={onClose}
      width={520}
      maskClosable={false}
      keyboard={false}
      styles={{ body: { padding: '16px 24px', background: '#1a1a1a' }, header: { background: '#1a1a1a', borderBottom: '1px solid #303030' } }}
    >
      <div style={{ padding: '8px 0' }}>
        <Steps
          direction="vertical"
          current={current}
          items={steps.map((step) => {
            const config = statusConfig[step.status];
            return {
              icon: config.icon,
              title: (
                <Text style={{ color: step.status === 'error' ? '#ff4d4f' : '#e0e0e0', fontWeight: step.status === 'loading' ? 600 : 400 }}>
                  {step.label}
                </Text>
              ),
              description: (
                <div>
                  {step.detail && (
                    <Text style={{ color: '#888', fontSize: 12, display: 'block', marginTop: 4 }}>
                      {step.detail}
                    </Text>
                  )}
                  {step.error && (
                    <div style={{ 
                      background: '#2a1215', 
                      border: '1px solid #ff4d4f22', 
                      borderRadius: 6, 
                      padding: '8px 12px', 
                      marginTop: 8 
                    }}>
                      <Text type="danger" style={{ fontSize: 12, display: 'block' }}>
                        <CloseCircleFilled style={{ marginRight: 6 }} />
                        {step.error}
                      </Text>
                    </div>
                  )}
                </div>
              ),
              status: step.status === 'loading' ? 'process' : step.status === 'error' ? 'error' : step.status === 'success' || step.status === 'warning' ? 'finish' : 'wait',
            };
          })}
          style={{ 
            '--ant-steps-icon-size': '28px',
          } as any}
        />
      </div>

      {(hasError || allDone || customActions.length > 0) && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'flex-end', 
          gap: 8, 
          marginTop: 20,
          paddingTop: 16,
          borderTop: '1px solid #303030'
        }}>
          {hasError && onCancel && (
            <Button onClick={onCancel} size="middle">
              Tentar Novamente
            </Button>
          )}
          {customActions.map((action) => (
            <Button
              key={action.key}
              type={action.primary ? 'primary' : 'default'}
              danger={Boolean(action.danger)}
              onClick={action.onClick}
              size="middle"
            >
              {action.label}
            </Button>
          ))}
          {(hasError || allDone) && (
            <Button type="primary" onClick={onClose} size="middle" danger={hasError && !allDone}>
              {allDone ? 'Fechar' : 'Cancelar'}
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
