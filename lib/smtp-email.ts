import nodemailer from 'nodemailer';

export type SmtpCredentials = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  fromName?: string;
};

function address(name: string | undefined, email: string) {
  const cleanName = (name || '').replace(/[\r\n"]/g, '').trim();
  return cleanName ? `"${cleanName}" <${email}>` : email;
}

/**
 * Send through the SMTP account configured by the platform admin.
 *
 * Credentials are intentionally supplied at call time from the encrypted
 * provider vault. They never become process environment variables and are not
 * written to logs. Cloudflare Workers' current node compatibility implements
 * `node:tls`, which is what Nodemailer uses for implicit TLS on port 465.
 */
export async function sendSmtpEmail(input: {
  credentials: SmtpCredentials;
  to: string;
  subject: string;
  html: string;
}) {
  const transport = nodemailer.createTransport({
    host: input.credentials.host,
    port: input.credentials.port,
    secure: input.credentials.secure,
    auth: {
      user: input.credentials.username,
      pass: input.credentials.password,
    },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
  });
  const result = await transport.sendMail({
    from: address(input.credentials.fromName, input.credentials.from),
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
  transport.close();
  if (!result.messageId)
    throw new Error('SMTP accepted no message reference.');
  return {
    id: result.messageId,
    accepted: result.accepted.map(String),
    rejected: result.rejected.map(String),
  };
}

export async function verifySmtp(credentials: SmtpCredentials) {
  const transport = nodemailer.createTransport({
    host: credentials.host,
    port: credentials.port,
    secure: credentials.secure,
    auth: { user: credentials.username, pass: credentials.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transport.verify();
  transport.close();
}
