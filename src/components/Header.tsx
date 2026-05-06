'use client';

import { Layout, Avatar, Space, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';

const { Header: AntHeader } = Layout;
const { Text } = Typography;

export default function Header() {
  return (
    <AntHeader
      style={{
        background: '#141414',
        borderBottom: '1px solid #303030',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 24px',
        height: 64,
        marginLeft: 240,
      }}
    >
      <Space>
        <Text type="secondary">Admin</Text>
        <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: '#1677ff' }} />
      </Space>
    </AntHeader>
  );
}
