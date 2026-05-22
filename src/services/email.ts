import nodemailer from 'nodemailer';

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
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
  const from = `Felipe (Vortek) <${fromAddress}>`;
  const transport = createTransport();
  try {
    return await transport.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      attachments: input.attachments,
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
