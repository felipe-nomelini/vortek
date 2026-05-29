'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Input, InputNumber, Select, Button, Tag, Table, Modal, Tabs, Typography, Switch, Space, message, Upload, Avatar } from 'antd';
import type { TableProps, UploadProps } from 'antd';
import { PlusOutlined, UserOutlined, UploadOutlined } from '@ant-design/icons';
import { createClient } from '@/lib/supabase-client';

const { Title, Text } = Typography;

type UserRole = 'admin' | 'gerente' | 'operador' | 'visualizador';

interface Usuario {
  id: number;
  nome: string;
  email: string;
  cargo: UserRole;
  ativo: boolean;
  avatar?: string;
}

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'gerente', label: 'Gerente' },
  { value: 'operador', label: 'Operador' },
  { value: 'visualizador', label: 'Visualizador' },
];

const roleColor: Record<UserRole, string> = { admin: 'red', gerente: 'blue', operador: 'green', visualizador: 'default' };

const cardBg = { background: '#141414', border: '1px solid #303030', borderRadius: 8 };
const inputStyle = { background: '#1f1f1f', border: '1px solid #303030', borderRadius: 6 };

function saveIntegrations(ml: boolean, dslite: boolean) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('vortek_integrations', JSON.stringify({ ml, dslite }));
  }
}

export default function ConfiguracoesPage() {
  const [tab, setTab] = useState('empresa');
  const [messageApi, contextHolder] = message.useMessage();
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [savingEmpresa, setSavingEmpresa] = useState(false);

  const [empresa, setEmpresa] = useState({
    nome: '',
    nickname: '',
    cnpj: '',
    endereco: '',
    email: '',
    telefone: '',
    uf_fiscal: '',
    cod_municipio_fiscal: '',
  });
  const patchEmpresa = (d: Partial<typeof empresa>) => setEmpresa(p => ({ ...p, ...d }));

  const [ml, setMl] = useState({ clientId: '', clientSecret: '', redirectUri: '', conectado: false });
  const [dslite, setDslite] = useState({ url: '', token: '', conectado: false });
  const [brasilNfe, setBrasilNfe] = useState({ token: '', userToken: '', url: '', conectado: false });
  const [defaultNfeProvider, setDefaultNfeProvider] = useState<'brasilnfe'>('brasilnfe');

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: empresaRows } = await supabase
        .from('empresa')
        .select('id,nome,nickname,cnpj,endereco,email,telefone,uf_fiscal,cod_municipio_fiscal')
        .order('updated_at', { ascending: false })
        .limit(1);

      const empresaAtual = empresaRows?.[0];
      if (empresaAtual) {
        setEmpresaId(empresaAtual.id);
        setEmpresa({
          nome: empresaAtual.nome || '',
          nickname: empresaAtual.nickname || '',
          cnpj: empresaAtual.cnpj || '',
          endereco: empresaAtual.endereco || '',
          email: empresaAtual.email || '',
          telefone: empresaAtual.telefone || '',
          uf_fiscal: empresaAtual.uf_fiscal || '',
          cod_municipio_fiscal: empresaAtual.cod_municipio_fiscal || '',
        });
      }

      const { data: integracoes } = await supabase.from('integracoes').select('*');
      if (!integracoes) return;
      for (const i of integracoes) {
        if (i.tipo === 'mercadolivre') setMl({ clientId: i.client_id || '', clientSecret: i.client_secret || '', redirectUri: i.redirect_uri || '', conectado: i.conectado });
        if (i.tipo === 'dslite') setDslite({ url: i.url || '', token: i.access_token || '', conectado: i.conectado });
        if (i.tipo === 'brasilnfe') setBrasilNfe({ token: i.access_token || '', userToken: i.refresh_token || '', url: i.url || '', conectado: i.conectado });
      }
      const configRes = await fetch('/api/configuracoes');
      if (configRes.ok) {
        const conf = await configRes.json();
        const provider = String(conf?.nfe_provider_default || '').toLowerCase();
        if (provider === 'brasilnfe') {
          setDefaultNfeProvider(provider);
        }
      }
    };
    load();
  }, []);

  const salvarEmpresa = useCallback(async () => {
    const supabase = createClient();
    setSavingEmpresa(true);
    const ufFiscal = String(empresa.uf_fiscal || '').trim().toUpperCase();
    const codMunicipioFiscal = String(empresa.cod_municipio_fiscal || '').replace(/\D/g, '');

    if (!/^[A-Z]{2}$/.test(ufFiscal)) {
      setSavingEmpresa(false);
      messageApi.error('UF Fiscal inválida. Use 2 letras (ex.: RS).');
      return;
    }
    if (codMunicipioFiscal && !/^\d{7}$/.test(codMunicipioFiscal)) {
      setSavingEmpresa(false);
      messageApi.error('Código Município (IBGE) inválido. Use 7 dígitos.');
      return;
    }

    const payload = {
      nome: empresa.nome?.trim() || '',
      nickname: empresa.nickname?.trim() || '',
      cnpj: empresa.cnpj?.trim() || '',
      endereco: empresa.endereco?.trim() || '',
      email: empresa.email?.trim() || '',
      telefone: empresa.telefone?.trim() || '',
      uf_fiscal: ufFiscal,
      cod_municipio_fiscal: codMunicipioFiscal || null,
      updated_at: new Date().toISOString(),
    };

    let error: { message: string } | null = null;

    if (empresaId) {
      const result = await supabase
        .from('empresa')
        .update(payload)
        .eq('id', empresaId);
      error = result.error;
    } else {
      const result = await supabase
        .from('empresa')
        .insert(payload)
        .select('id')
        .single();
      error = result.error;
      if (!result.error && result.data?.id) setEmpresaId(result.data.id);
    }

    setSavingEmpresa(false);
    if (error) {
      messageApi.error(`Falha ao salvar dados da empresa: ${error.message}`);
      return;
    }

    messageApi.success('Dados da empresa salvos');
  }, [empresa, empresaId, messageApi]);

  const saveIntegracao = useCallback(async (tipo: string, data: Record<string, any>) => {
    const supabase = createClient();
    await supabase.from('integracoes').update(data).eq('tipo', tipo);
  }, []);

  useEffect(() => {
    saveIntegrations(ml.conectado, dslite.conectado);
  }, [ml.conectado, dslite.conectado]);

const conectarML = () => {
  if (!ml.clientId || !ml.redirectUri) { messageApi.warning('Preencha Client ID e Redirect URI'); return; }
  window.location.href = '/api/integracao/ml/connect';
};

const testarDslite = () => {
    if (!dslite.url || !dslite.token) { messageApi.warning('Preencha a URL e o Token'); return; }
    setDslite(p => ({ ...p, conectado: true }));
    saveIntegracao('dslite', { url: dslite.url, access_token: dslite.token, conectado: true });
    messageApi.success('Conexão testada com sucesso!');
  };

  const salvarDefaultProvider = useCallback(async (provider: 'brasilnfe') => {
    const res = await fetch('/api/configuracoes/fiscal-provider', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultProvider: provider }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      messageApi.error(json?.erro || 'Falha ao salvar provedor fiscal padrão');
      return;
    }
    setDefaultNfeProvider(provider);
    messageApi.success('Provedor fiscal padrão atualizado');
  }, [messageApi]);

  const testarBrasilNfe = () => {
    if (!brasilNfe.token) { messageApi.warning('Preencha o Token da Brasil NFe'); return; }
    setBrasilNfe((p) => ({ ...p, conectado: true }));
    saveIntegracao('brasilnfe', {
      access_token: brasilNfe.token,
      refresh_token: brasilNfe.userToken || null,
      url: brasilNfe.url || null,
      conectado: true,
    });
    messageApi.success('Configuração da Brasil NFe salva!');
  };

  const [usuarios, setUsuarios] = useState<Usuario[]>([
    { id: 1, nome: 'Admin', email: 'admin@vortek.shop', cargo: 'admin', ativo: true },
    { id: 2, nome: 'Gerente', email: 'gerente@vortek.shop', cargo: 'gerente', ativo: true },
    { id: 3, nome: 'Operador', email: 'operador@vortek.shop', cargo: 'operador', ativo: false },
  ]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editUser, setEditUser] = useState<Usuario | null>(null);
  const [novoUsuario, setNovoUsuario] = useState({ nome: '', email: '', senha: '', cargo: 'operador' as UserRole });

  const criarUsuario = () => {
    if (!novoUsuario.nome || !novoUsuario.email || !novoUsuario.senha) { messageApi.warning('Preencha todos os campos'); return; }
    setUsuarios(p => [...p, { id: p.length + 1, ...novoUsuario, ativo: true }]);
    setNovoUsuario({ nome: '', email: '', senha: '', cargo: 'operador' });
    setModalOpen(false);
    messageApi.success('Usuário criado!');
  };

  const toggleUsuario = (id: number) => setUsuarios(p => p.map(u => u.id === id ? { ...u, ativo: !u.ativo } : u));

  const openEdit = (user: Usuario) => {
    setEditUser({ ...user });
    setEditModalOpen(true);
  };

  const saveEdit = () => {
    if (!editUser) return;
    setUsuarios(p => p.map(u => u.id === editUser.id ? editUser : u));
    if (editUser.id === 1) {
      localStorage.setItem('vortek_user_profile', JSON.stringify({ nome: editUser.nome, avatar: editUser.avatar }));
    }
    setEditModalOpen(false);
    messageApi.success('Perfil atualizado!');
  };

  const handleAvatarUpload: UploadProps['customRequest'] = ({ file, onSuccess }) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setEditUser(p => p ? { ...p, avatar: dataUrl } : p);
      onSuccess?.(dataUrl);
    };
    reader.readAsDataURL(file as Blob);
  };

  const userColumns: TableProps<Usuario>['columns'] = [
    {
      title: '', dataIndex: 'avatar', key: 'avatar', width: 40,
      render: (a: string | undefined) => <Avatar size={24} src={a} icon={!a ? <UserOutlined /> : undefined} style={{ backgroundColor: '#1677ff' }} />,
    },
    { title: 'Nome', dataIndex: 'nome', key: 'nome' },
    { title: 'E-mail', dataIndex: 'email', key: 'email' },
    { title: 'Cargo', dataIndex: 'cargo', key: 'cargo', render: (c: UserRole) => <Tag color={roleColor[c]}>{c.charAt(0).toUpperCase() + c.slice(1)}</Tag> },
    { title: 'Status', dataIndex: 'ativo', key: 'ativo', render: (a: boolean) => <Tag color={a ? 'green' : 'red'}>{a ? 'Ativo' : 'Inativo'}</Tag> },
    {
      title: 'Ações', key: 'actions', width: 120,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => openEdit(r)}>Editar</Button>
          <Button size="small" onClick={() => toggleUsuario(r.id)}>{r.ativo ? 'Desativar' : 'Ativar'}</Button>
        </Space>
      ),
    },
  ];

  const [margem, setMargem] = useState(30);
  const [notif, setNotif] = useState({ email: true, push: false });

  const integrations = [
    {
      key: 'ml', nome: 'Mercado Livre', conectado: ml.conectado, cor: '#1677ff', bg: '#111d2e',
      fields: (
        <>
          <Input size="small" placeholder="Client ID (App ID)" value={ml.clientId} onChange={e => setMl(p => ({ ...p, clientId: e.target.value }))} onBlur={() => saveIntegracao('mercadolivre', { client_id: ml.clientId })} style={inputStyle} />
          <Input size="small" placeholder="Client Secret" type="password" value={ml.clientSecret} onChange={e => setMl(p => ({ ...p, clientSecret: e.target.value }))} onBlur={() => saveIntegracao('mercadolivre', { client_secret: ml.clientSecret })} style={inputStyle} />
          <Input size="small" placeholder="Redirect URI" value={ml.redirectUri} onChange={e => setMl(p => ({ ...p, redirectUri: e.target.value }))} onBlur={() => saveIntegracao('mercadolivre', { redirect_uri: ml.redirectUri })} style={inputStyle} />
        </>
      ),
      action: { label: 'Conectar com ML', onClick: conectarML },
    },
    {
      key: 'dslite', nome: 'DSLite', conectado: dslite.conectado, cor: '#fa8c16', bg: '#2a1706',
      fields: (
        <>
          <Input size="small" placeholder="URL da API" value={dslite.url} onChange={e => setDslite(p => ({ ...p, url: e.target.value }))} onBlur={() => saveIntegracao('dslite', { url: dslite.url })} style={inputStyle} />
          <Input size="small" placeholder="Token de Acesso" type="password" value={dslite.token} onChange={e => setDslite(p => ({ ...p, token: e.target.value }))} onBlur={() => saveIntegracao('dslite', { access_token: dslite.token })} style={inputStyle} />
        </>
      ),
      action: { label: 'Testar Conexão', onClick: testarDslite },
    },
    {
      key: 'brasilnfe', nome: 'Brasil NFe', conectado: brasilNfe.conectado, cor: '#13c2c2', bg: '#0b2525',
      fields: (
        <>
          <Input size="small" placeholder="Token da Empresa" type="password" value={brasilNfe.token} onChange={e => setBrasilNfe(p => ({ ...p, token: e.target.value }))} onBlur={() => saveIntegracao('brasilnfe', { access_token: brasilNfe.token })} style={inputStyle} />
          <Input size="small" placeholder="User Token (opcional)" type="password" value={brasilNfe.userToken} onChange={e => setBrasilNfe(p => ({ ...p, userToken: e.target.value }))} onBlur={() => saveIntegracao('brasilnfe', { refresh_token: brasilNfe.userToken })} style={inputStyle} />
          <Input size="small" placeholder="URL Base (opcional)" value={brasilNfe.url} onChange={e => setBrasilNfe(p => ({ ...p, url: e.target.value }))} onBlur={() => saveIntegracao('brasilnfe', { url: brasilNfe.url })} style={inputStyle} />
        </>
      ),
      action: { label: 'Salvar Brasil NFe', onClick: testarBrasilNfe },
    },
  ];

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 20 }}>Configurações</Title>

      <Card styles={{ body: { padding: 0 } }} style={{ ...cardBg, overflow: 'hidden' }}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          tabBarStyle={{ margin: 0, paddingLeft: 16, background: '#1a1a1a', borderBottom: '1px solid #303030' }}
          style={{ padding: 20 }}
          items={[
            {
              key: 'empresa', label: '🏢 Empresa',
              children: (
                <Row gutter={[16, 12]}>
                  <Col span={12}><div style={{ color: '#a0a0a0', fontSize: 13 }}>Nome da Loja</div><Input size="small" value={empresa.nome} onChange={e => patchEmpresa({ nome: e.target.value })} style={inputStyle} /></Col>
                  <Col span={12}><div style={{ color: '#a0a0a0', fontSize: 13 }}>Nickname ML</div><Input size="small" value={empresa.nickname} onChange={e => patchEmpresa({ nickname: e.target.value })} style={inputStyle} /></Col>
                  <Col span={12}><div style={{ color: '#a0a0a0', fontSize: 13 }}>CNPJ</div><Input size="small" value={empresa.cnpj} onChange={e => patchEmpresa({ cnpj: e.target.value })} style={inputStyle} /></Col>
                  <Col span={12}><div style={{ color: '#a0a0a0', fontSize: 13 }}>Telefone</div><Input size="small" value={empresa.telefone} onChange={e => patchEmpresa({ telefone: e.target.value })} style={inputStyle} /></Col>
                  <Col span={12}><div style={{ color: '#a0a0a0', fontSize: 13 }}>UF Fiscal</div><Input size="small" maxLength={2} value={empresa.uf_fiscal} onChange={e => patchEmpresa({ uf_fiscal: e.target.value.toUpperCase() })} style={inputStyle} /></Col>
                  <Col span={12}><div style={{ color: '#a0a0a0', fontSize: 13 }}>Código Município (IBGE)</div><Input size="small" maxLength={7} value={empresa.cod_municipio_fiscal} onChange={e => patchEmpresa({ cod_municipio_fiscal: e.target.value.replace(/\D/g, '') })} style={inputStyle} /></Col>
                  <Col span={12}><div style={{ color: '#a0a0a0', fontSize: 13 }}>E-mail</div><Input size="small" value={empresa.email} onChange={e => patchEmpresa({ email: e.target.value })} style={inputStyle} /></Col>
                  <Col span={24}><div style={{ color: '#a0a0a0', fontSize: 13 }}>Endereço</div><Input size="small" value={empresa.endereco} onChange={e => patchEmpresa({ endereco: e.target.value })} style={inputStyle} /></Col>
                  <Col span={24}>
                    <Button type="primary" size="small" loading={savingEmpresa} onClick={salvarEmpresa}>
                      Salvar dados da empresa
                    </Button>
                  </Col>
                </Row>
              ),
            },
            {
              key: 'integracoes', label: '🔐 Integrações',
              children: (
                <Row gutter={[16, 16]}>
                  <Col span={24}>
                    <Card styles={{ body: { padding: 12 } }} style={{ ...cardBg }}>
                      <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Text style={{ color: '#e0e0e0', fontWeight: 600 }}>Provedor fiscal padrão (NF-e)</Text>
                        <Select
                          size="small"
                          style={{ minWidth: 220 }}
                          value={defaultNfeProvider}
                          onChange={(v: 'brasilnfe') => salvarDefaultProvider(v)}
                          options={[
                            { value: 'brasilnfe', label: 'Brasil NFe (primário)' },
                          ]}
                        />
                      </Space>
                    </Card>
                  </Col>
                  {integrations.map(api => (
                    <Col xs={24} lg={8} key={api.key}>
                      <Card styles={{ body: { padding: 16 } }} style={{ ...cardBg, height: '100%', borderColor: api.conectado ? api.cor : '#303030' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 12, height: 12, borderRadius: 6, background: api.conectado ? api.cor : '#555' }} />
                            <Text style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 15 }}>{api.nome}</Text>
                          </div>
                          {api.conectado ? <Tag color="green" style={{ margin: 0 }}>Conectado</Tag> : <Tag color="default" style={{ margin: 0 }}>Desconectado</Tag>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>{api.fields}</div>
                        <Button size="small" type="primary" onClick={api.action.onClick} style={{ width: '100%' }}>{api.action.label}</Button>
                      </Card>
                    </Col>
                  ))}
                </Row>
              ),
            },
            {
              key: 'usuarios', label: '👥 Usuários',
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ color: '#a0a0a0', fontSize: 13 }}>{usuarios.length} usuário(s) cadastrado(s)</Text>
                    <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>Novo Usuário</Button>
                  </div>
                  <Table<Usuario> dataSource={usuarios} columns={userColumns} rowKey="id" pagination={false} size="small" style={{ background: 'transparent' }} />

                  <Modal title="Novo Usuário" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={criarUsuario} okText="Criar">
                    <Space direction="vertical" style={{ width: '100%' }} size={12}>
                      <Input placeholder="Nome" value={novoUsuario.nome} onChange={e => setNovoUsuario(p => ({ ...p, nome: e.target.value }))} />
                      <Input placeholder="E-mail" value={novoUsuario.email} onChange={e => setNovoUsuario(p => ({ ...p, email: e.target.value }))} />
                      <Input.Password placeholder="Senha" value={novoUsuario.senha} onChange={e => setNovoUsuario(p => ({ ...p, senha: e.target.value }))} />
                      <Select placeholder="Cargo" value={novoUsuario.cargo} onChange={v => setNovoUsuario(p => ({ ...p, cargo: v }))} options={roleOptions} style={{ width: '100%' }} />
                    </Space>
                  </Modal>

                  <Modal title="Editar Usuário" open={editModalOpen} onCancel={() => setEditModalOpen(false)} onOk={saveEdit} okText="Salvar">
                    {editUser && (
                      <Space direction="vertical" style={{ width: '100%' }} size={12}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                          <Avatar size={64} src={editUser.avatar} icon={!editUser.avatar ? <UserOutlined /> : undefined} />
                          <Upload customRequest={handleAvatarUpload} showUploadList={false} accept="image/*">
                            <Button size="small" icon={<UploadOutlined />}>Alterar Foto</Button>
                          </Upload>
                        </div>
                        <Input placeholder="Nome" value={editUser.nome} onChange={e => setEditUser(p => p ? { ...p, nome: e.target.value } : p)} />
                        <Input placeholder="E-mail" value={editUser.email} onChange={e => setEditUser(p => p ? { ...p, email: e.target.value } : p)} />
                        <Select placeholder="Cargo" value={editUser.cargo} onChange={v => setEditUser(p => p ? { ...p, cargo: v } : p)} options={roleOptions} style={{ width: '100%' }} />
                      </Space>
                    )}
                  </Modal>
                </div>
              ),
            },
            {
              key: 'preferencias', label: '⚙️ Preferências',
              children: (
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={8}>
                    <div style={{ color: '#a0a0a0', fontSize: 13, marginBottom: 6 }}>Margem de Lucro Padrão</div>
                    <InputNumber size="small" suffix="%" value={margem} onChange={v => setMargem(v ?? 30)} style={{ ...inputStyle, width: '100%' }} min={0} max={100} />
                    <Text style={{ color: '#666', fontSize: 12, display: 'block', marginTop: 4 }}>Usada no cálculo do preço sugerido</Text>
                  </Col>
                  <Col xs={24} md={8}>
                    <div style={{ color: '#a0a0a0', fontSize: 13, marginBottom: 6 }}>Notificações por E-mail</div>
                    <Switch checked={notif.email} onChange={v => setNotif(p => ({ ...p, email: v }))} />
                  </Col>
                  <Col xs={24} md={8}>
                    <div style={{ color: '#a0a0a0', fontSize: 13, marginBottom: 6 }}>Notificações Push</div>
                    <Switch checked={notif.push} onChange={v => setNotif(p => ({ ...p, push: v }))} />
                  </Col>
                </Row>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
