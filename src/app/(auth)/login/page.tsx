'use client';

import { useState } from 'react';
import { Card, Input, Button, Typography, message } from 'antd';
import { useRouter } from 'next/navigation';

const { Title, Text } = Typography;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !senha) { message.warning('Preencha todos os campos'); return; }
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ email, senha }),
      });
      const payload = await response.json().catch(() => null) as { erro?: string } | null;

      if (!response.ok) {
        message.error(response.status === 401
          ? 'Credenciais inválidas'
          : payload?.erro || 'Não foi possível conectar ao Supabase. Verifique a configuração do sistema.');
        return;
      }

      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      console.error('[auth.login] request failed', error);
      message.error('Não foi possível conectar ao Supabase. Verifique a configuração do sistema.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000000',
    }}>
      <Card
        style={{
          width: 400, background: '#141414', border: '1px solid #303030', borderRadius: 8,
        }}
        styles={{ body: { padding: 32 } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <span style={{ color: '#1677ff', fontSize: 28, fontWeight: 700, letterSpacing: 2 }}>VORTEK</span>
          <br />
          <Text type="secondary" style={{ fontSize: 13 }}>Sistema de Gestão e Precificação</Text>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 13, marginBottom: 4 }}>E-mail</div>
            <Input
              size="large"
              placeholder="seu@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onPressEnter={handleLogin}
              style={{ background: '#1f1f1f', border: '1px solid #303030', borderRadius: 6 }}
            />
          </div>
          <div>
            <div style={{ color: '#a0a0a0', fontSize: 13, marginBottom: 4 }}>Senha</div>
            <Input.Password
              size="large"
              placeholder="********"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              onPressEnter={handleLogin}
              style={{ background: '#1f1f1f', border: '1px solid #303030', borderRadius: 6 }}
            />
          </div>
          <Button type="primary" size="large" loading={loading} onClick={handleLogin} style={{ marginTop: 8 }}>
            Entrar
          </Button>
        </div>
      </Card>
    </div>
  );
}
