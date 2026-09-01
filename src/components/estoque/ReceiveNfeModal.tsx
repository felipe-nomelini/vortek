'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Divider, Input, InputNumber, Modal, Select, Space, Spin,
  Table, Tag, Typography, Upload, message,
} from 'antd';
import { CameraOutlined, FileTextOutlined, SearchOutlined } from '@ant-design/icons';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { extractNfeAccessKey } from '@/lib/estoque-nfe';

type ProductOption = { id: string; sku: string; nome: string };
type ReceiptItem = {
  id: string;
  numero_item: number;
  produto_id: string | null;
  codigo_fornecedor: string | null;
  gtin: string | null;
  descricao: string;
  quantidade_esperada: number;
  quantidade_liberada: number;
  quantidade_nao_aproveitavel: number;
  produtos: ProductOption | null;
};
type Receipt = {
  id: string;
  chave_nfe: string;
  numero: string | null;
  serie: string | null;
  emitente_nome: string;
  status: string;
  itens: ReceiptItem[];
};
type Conference = { produtoId: string | null; good: number; damaged: number };

export default function ReceiveNfeModal(props: {
  open: boolean;
  initialReceiptId?: string | null;
  initialKey?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { open, initialReceiptId, initialKey, onClose, onChanged } = props;
  const [keyInput, setKeyInput] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [conference, setConference] = useState<Record<string, Conference>>({});
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [canManifest, setCanManifest] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const bootstrappedKeyRef = useRef<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    if (videoRef.current?.srcObject instanceof MediaStream) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const applyReceipt = useCallback((next: Receipt) => {
    setReceipt(next);
    setConference(Object.fromEntries(next.itens.map((item) => {
      const remaining = Math.max(0, item.quantidade_esperada - item.quantidade_liberada - item.quantidade_nao_aproveitavel);
      return [item.id, { produtoId: item.produto_id, good: remaining, damaged: 0 }];
    })));
    setProductOptions(next.itens.flatMap((item) => item.produtos ? [item.produtos] : []));
    setCanManifest(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    if (!initialReceiptId) return;
    setLoading(true);
    fetch(`/api/estoque/recebimentos/${initialReceiptId}`, { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error || 'Falha ao abrir o recebimento.');
        applyReceipt(result.receipt);
      })
      .catch((error) => messageApi.error(error.message))
      .finally(() => setLoading(false));
  }, [applyReceipt, initialReceiptId, messageApi, open, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const importNfe = useCallback(async (xml?: string, keyOverride?: string) => {
    const key = extractNfeAccessKey(keyOverride || xml || keyInput);
    if (!key) {
      messageApi.error('Informe ou leia uma chave válida de 44 dígitos.');
      return;
    }
    stopCamera();
    setKeyInput(key);
    setLoading(true);
    setCanManifest(false);
    try {
      const response = await fetch('/api/estoque/recebimentos/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: key, xml }),
      });
      const result = await response.json();
      if (!response.ok) {
        setCanManifest(Boolean(result?.canManifest));
        throw new Error(result?.error || 'Falha ao importar a NF-e.');
      }
      applyReceipt(result.receipt);
      messageApi.success(result.existing ? 'Recebimento existente reaberto.' : 'NF-e importada para conferência.');
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao importar a NF-e.');
    } finally {
      setLoading(false);
    }
  }, [applyReceipt, keyInput, messageApi, stopCamera]);

  useEffect(() => {
    if (!open || initialReceiptId || !initialKey || bootstrappedKeyRef.current === initialKey) return;
    bootstrappedKeyRef.current = initialKey;
    void importNfe(undefined, initialKey);
  }, [importNfe, initialKey, initialReceiptId, open]);

  const startCamera = async () => {
    stopCamera();
    setCameraActive(true);
    try {
      const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 250 });
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        videoRef.current || undefined,
        (result) => {
          if (!result) return;
          const key = extractNfeAccessKey(result.getText());
          if (key) {
            setKeyInput(key);
            void importNfe(undefined, key);
          }
        },
      );
    } catch (error: any) {
      stopCamera();
      messageApi.error(error?.message || 'Não foi possível abrir a câmera.');
    }
  };

  const manifest = () => Modal.confirm({
    title: 'Manifestar ciência da operação?',
    content: 'Esta ação registra um evento fiscal na SEFAZ para tentar liberar o XML. Ela não confirma o recebimento físico.',
    okText: 'Manifestar ciência',
    cancelText: 'Cancelar',
    onOk: async () => {
      const key = extractNfeAccessKey(keyInput);
      if (!key) throw new Error('Chave inválida.');
      const response = await fetch('/api/estoque/recebimentos/manifestar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: key, confirmar: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao manifestar ciência.');
      messageApi.success(result.message);
      setCanManifest(false);
    },
  });

  const searchProducts = async (value: string) => {
    if (value.trim().length < 2) return;
    setSearchingProducts(true);
    try {
      const response = await fetch(`/api/estoque/produtos?q=${encodeURIComponent(value)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao buscar produtos.');
      setProductOptions((current) => {
        const map = new Map(current.map((product) => [product.id, product]));
        for (const product of result.products || []) map.set(product.id, product);
        return [...map.values()];
      });
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao buscar produtos.');
    } finally {
      setSearchingProducts(false);
    }
  };

  const confirmReceipt = async () => {
    if (!receipt) return;
    const payload = receipt.itens.map((item) => ({
      itemId: item.id,
      produtoId: conference[item.id]?.produtoId,
      quantidadeLiberada: conference[item.id]?.good || 0,
      quantidadeNaoAproveitavel: conference[item.id]?.damaged || 0,
    }));
    if (payload.some((item) => !item.produtoId)) {
      messageApi.error('Vincule todos os itens a produtos Bentevi antes de confirmar.');
      return;
    }
    setConfirming(true);
    try {
      const response = await fetch(`/api/estoque/recebimentos/${receipt.id}/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), itens: payload }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao confirmar o recebimento.');
      applyReceipt(result.receipt);
      result.mlSyncWarning ? messageApi.warning(result.mlSyncWarning) : messageApi.success('Recebimento físico confirmado.');
      onChanged();
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao confirmar o recebimento.');
    } finally {
      setConfirming(false);
    }
  };

  const close = () => {
    stopCamera();
    setReceipt(null);
    setKeyInput('');
    setCanManifest(false);
    bootstrappedKeyRef.current = null;
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      width={1100}
      title={receipt ? `Conferir NF-e ${receipt.numero || receipt.chave_nfe.slice(-9)}` : 'Receber NF-e'}
      footer={receipt ? [
        <Button key="close" onClick={close}>Fechar</Button>,
        <Button key="confirm" type="primary" loading={confirming} disabled={receipt.status === 'conferido'} onClick={confirmReceipt}>
          Confirmar recebimento
        </Button>,
      ] : null}
      destroyOnHidden
    >
      {contextHolder}
      <Spin spinning={loading}>
        {!receipt ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert showIcon type="info" message="A leitura apenas importa a NF-e" description="O saldo só fica disponível depois da conferência física e da confirmação abaixo." />
            <Input.Search
              size="large"
              value={keyInput}
              onChange={(event) => setKeyInput(event.target.value)}
              onSearch={() => void importNfe()}
              enterButton={<><SearchOutlined /> Buscar NF-e</>}
              placeholder="Leia ou cole a chave de acesso de 44 dígitos"
            />
            <Space wrap>
              <Button icon={<CameraOutlined />} onClick={() => void startCamera()}>{cameraActive ? 'Reiniciar câmera' : 'Usar câmera do celular'}</Button>
              <Upload
                accept=".xml,text/xml,application/xml"
                showUploadList={false}
                beforeUpload={(file) => {
                  if (file.size > 3_000_000) messageApi.error('O XML deve ter no máximo 3 MB.');
                  else void file.text().then((xml) => importNfe(xml));
                  return false;
                }}
              >
                <Button icon={<FileTextOutlined />}>Enviar XML do fornecedor</Button>
              </Upload>
              {canManifest && <Button danger onClick={manifest}>Manifestar ciência e obter XML</Button>}
            </Space>
            {cameraActive && <video ref={videoRef} muted playsInline style={{ width: '100%', maxHeight: 420, borderRadius: 12, background: '#050505' }} />}
            <Typography.Text type="secondary">Leitores USB ou Bluetooth também funcionam: posicione o cursor no campo e faça a leitura.</Typography.Text>
          </Space>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap>
              <Typography.Text strong>{receipt.emitente_nome}</Typography.Text>
              <Tag>{receipt.itens.length} itens</Tag>
              <Tag color={receipt.status === 'conferido' ? 'green' : receipt.status === 'parcial' ? 'blue' : 'gold'}>{receipt.status.replaceAll('_', ' ')}</Tag>
            </Space>
            <Divider style={{ margin: 0 }} />
            <Table
              rowKey="id"
              pagination={false}
              scroll={{ x: 980 }}
              dataSource={receipt.itens}
              columns={[
                {
                  title: 'Item da NF-e', width: 300,
                  render: (_: unknown, item: ReceiptItem) => <Space direction="vertical" size={2}><Typography.Text strong>{item.descricao}</Typography.Text><Typography.Text type="secondary">Cód. {item.codigo_fornecedor || '—'} · GTIN {item.gtin || '—'}</Typography.Text></Space>,
                },
                {
                  title: 'Produto Bentevi', width: 330,
                  render: (_: unknown, item: ReceiptItem) => <Select
                    showSearch filterOption={false} style={{ width: '100%' }}
                    value={conference[item.id]?.produtoId || undefined}
                    placeholder="Buscar e vincular produto"
                    notFoundContent={searchingProducts ? <Spin size="small" /> : null}
                    onSearch={(value) => void searchProducts(value)}
                    onChange={(produtoId) => setConference((current) => ({ ...current, [item.id]: { ...current[item.id], produtoId } }))}
                    options={productOptions.map((product) => ({ value: product.id, label: `${product.sku} · ${product.nome}` }))}
                  />,
                },
                { title: 'Esperado', width: 90, render: (_: unknown, item: ReceiptItem) => `${item.quantidade_esperada} un.` },
                {
                  title: 'Boas', width: 100,
                  render: (_: unknown, item: ReceiptItem) => <InputNumber min={0} max={item.quantidade_esperada - item.quantidade_liberada - item.quantidade_nao_aproveitavel - (conference[item.id]?.damaged || 0)} value={conference[item.id]?.good || 0} onChange={(good) => setConference((current) => ({ ...current, [item.id]: { ...current[item.id], good: Number(good || 0) } }))} />,
                },
                {
                  title: 'Avariadas', width: 110,
                  render: (_: unknown, item: ReceiptItem) => <InputNumber min={0} max={item.quantidade_esperada - item.quantidade_liberada - item.quantidade_nao_aproveitavel - (conference[item.id]?.good || 0)} value={conference[item.id]?.damaged || 0} onChange={(damaged) => setConference((current) => ({ ...current, [item.id]: { ...current[item.id], damaged: Number(damaged || 0) } }))} />,
                },
              ]}
            />
            <Alert type="warning" showIcon message="Item sem correspondência?" description="Crie o produto na tela Produtos e volte para vinculá-lo. A Bentevi não cria cadastros incompletos a partir da NF-e." />
          </Space>
        )}
      </Spin>
    </Modal>
  );
}
