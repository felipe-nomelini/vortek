import nodemailer from 'nodemailer';
import path from 'node:path';

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content?: Buffer;
    path?: string;
    contentType?: string;
    cid?: string;
  }>;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function sanitizeSmtpPass(raw: string): string {
  // Gmail app-passwords are often copied with spaces for readability.
  return raw.replace(/\s+/g, '');
}

function maskUser(user: string): string {
  const [local, domain] = user.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 2) || '*';
  return `${head}***@${domain}`;
}

function createTransport() {
  const host = requireEnv('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const user = requireEnv('SMTP_USER');
  const pass = sanitizeSmtpPass(requireEnv('SMTP_PASS'));

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

export async function sendEmail(input: SendMailInput) {
  const fromAddress = process.env.EMAIL_FROM_NFE || process.env.SMTP_USER || '';
  if (!fromAddress) {
    throw new Error('Missing required env: EMAIL_FROM_NFE or SMTP_USER');
  }
  const from = `Bentevi <${fromAddress}>`;
  const transport = createTransport();
  const attachments = [...(input.attachments || [])];
  if (input.html?.includes('cid:bentevi-logo')) {
    attachments.push({
      filename: 'bentevi-wordmark.png',
      path: path.join(process.cwd(), 'public', 'branding', 'bentevi', 'bentevi-wordmark.png'),
      contentType: 'image/png',
      cid: 'bentevi-logo',
    });
  }
  try {
    return await transport.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments,
    });
  } catch (err: any) {
    const host = process.env.SMTP_HOST || '';
    const port = process.env.SMTP_PORT || '';
    const user = process.env.SMTP_USER || '';
    console.error(JSON.stringify({
      event: 'smtp_send_failed',
      host,
      port,
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      user: maskUser(user),
      code: err?.code || null,
      message: err?.message || 'unknown_error',
      timestamp_utc: new Date().toISOString(),
    }));
    throw err;
  }
}

export function getEmailChannelStatus() {
  return {
    configured: Boolean(
      String(process.env.SMTP_HOST || '').trim()
      && String(process.env.SMTP_USER || '').trim()
      && String(process.env.SMTP_PASS || '').trim()
      && String(process.env.EMAIL_FROM_NFE || process.env.SMTP_USER || '').trim()
    ),
  };
}

export async function verifyEmailTransport() {
  const transport = createTransport();
  await transport.verify();
  return { ok: true as const };
}
