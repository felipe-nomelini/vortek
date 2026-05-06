'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Modal, Progress, Button, Typography, Space } from 'antd';
import { CloseOutlined, StopOutlined, CheckCircleFilled, CloseCircleFilled, InfoCircleFilled } from '@ant-design/icons';

const { Text } = Typography;

interface LogEntry {
  type: 'success' | 'error' | 'info';
  message: string;
  timestamp: string;
}

interface JobData {
  id: string;
  tipo: string;
  status: string;
  progresso: number;
  total: number;
  processados: number;
  log: LogEntry[];
  cancelado: boolean;
  created_at: string;
  finished_at: string | null;
}

interface ProgressModalProps {
  jobId: string | null;
  title?: string;
  onClose?: () => void;
}

const iconMap = {
  success: <CheckCircleFilled style={{ color: '#52c41a', fontSize: 14 }} />,
  error: <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 14 }} />,
  info: <InfoCircleFilled style={{ color: '#1677ff', fontSize: 14 }} />,
};

export default function ProgressModal({ jobId, title = 'Processando...', onClose }: ProgressModalProps) {
  const [job, setJob] = useState<JobData | null>(null);
  const [open, setOpen] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) { stopPolling(); return; }
      const data = await res.json();
      setJob(data);
      if (data.status === 'completo' || data.status === 'erro' || data.status === 'cancelado') {
        stopPolling();
      }
    } catch { stopPolling(); }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  }, []);

  useEffect(() => {
    if (jobId) {
      setOpen(true);
      poll(jobId);
      pollingRef.current = setInterval(() => poll(jobId), 1000);
    } else {
      setOpen(false);
      stopPolling();
    }
    return stopPolling;
  }, [jobId, poll, stopPolling]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [job?.log]);

  const handleCancel = async () => {
    if (!job) return;
    await fetch(`/api/jobs/${job.id}`, { method: 'POST' });
  };

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  const isFinal = job?.status === 'completo' || job?.status === 'erro' || job?.status === 'cancelado';
  const summary = job?.log?.find(l => l.type === 'info' && l.message.startsWith('Sync concluído'))?.message;

  return (
    <Modal
      open={open}
      onCancel={isFinal ? handleClose : undefined}
      closable={isFinal}
      footer={
        <Space>
          {!isFinal && <Button icon={<StopOutlined />} danger onClick={handleCancel} loading={!job}>Cancelar</Button>}
          {isFinal && <Button type="primary" icon={<CloseOutlined />} onClick={handleClose}>Fechar</Button>}
        </Space>
      }
      title={<span style={{ color: '#e0e0e0' }}>{title}</span>}
      width={600}
      styles={{ body: { padding: 20 } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {job && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ color: '#a0a0a0', fontSize: 13 }}>
                {job.status === 'completo' ? 'Concluído' :
                 job.status === 'erro' ? 'Erro' :
                 job.status === 'cancelado' ? 'Cancelado' :
                 job.status === 'rodando' ? job.total > 0 ? `Processando: ${job.processados} de ${job.total}` : 'Preparando...' :
                 'Aguardando'}
              </Text>
              <Text style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>{job.progresso}%</Text>
            </div>
            <Progress
              percent={job.progresso}
              strokeColor={job.status === 'erro' ? '#ff4d4f' : job.status === 'cancelado' ? '#faad14' : '#5aab2c'}
              trailColor="#303030"
              size="small"
            />
          </div>
        )}

        {summary && <Text style={{ color: '#a0a0a0', fontSize: 12 }}>{summary}</Text>}

        <div style={{
          background: '#1a1a1a', border: '1px solid #303030', borderRadius: 6,
          padding: 12, maxHeight: 250, overflowY: 'auto',
          fontFamily: 'monospace', fontSize: 12,
        }}>
          {(job?.log || []).map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>{iconMap[entry.type]}</span>
              <span style={{ color: '#c0c0c0', whiteSpace: 'pre-wrap' }}>{entry.message}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </Modal>
  );
}
