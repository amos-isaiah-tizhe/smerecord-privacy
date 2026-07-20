'use strict';
/**
 * utils/email.js — Production-grade email sender
 * Table-based layout, inline styles, Outlook-safe, dark-mode aware.
 */

const nodemailer = require('nodemailer');

const BRAND = {
  name:     'SME Record',
  support:  process.env.SUPPORT_EMAIL || 'support@smerecord.com',
  primary:  '#6d28d9',   // purple
  bgOuter:  '#f3f4f6',
  bgCard:   '#ffffff',
  text:     '#111827',
  muted:    '#6b7280',
  border:   '#e5e7eb'
};

const createTransporter = () =>
  nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: parseInt(process.env.SMTP_PORT, 10) === 465,
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls:    { rejectUnauthorized: false }
  });

const sendEmail = async ({ to, subject, html, text }) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from:    `"${BRAND.name}" <${process.env.EMAIL_FROM || 'noreply@smerecord.com'}>`,
    to,
    subject,
    html,
    text:    text || html.replace(/<style[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
  });
};

/**
 * Wraps inner HTML in a production-safe, table-based email shell.
 * - Outer background, centered 600px container
 * - Safe fonts only (Arial/Helvetica)
 * - Inline styles, no flex/grid
 * - Dark-mode meta hint
 */
const baseLayout = ({ preheader = '', title, bodyHtml }) => `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${title}</title>
  <!--[if mso]>
  <style type="text/css">
    table, td { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:${BRAND.bgOuter};-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;color:${BRAND.bgOuter};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${preheader}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bgOuter};padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:600px;max-width:600px;background:${BRAND.bgCard};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">

          <!-- Header -->
          <tr>
            <td align="center" style="padding:32px 32px 8px 32px;">
              <div style="font-size:28px;font-weight:bold;color:${BRAND.primary};font-family:Arial,Helvetica,sans-serif;">
                ${BRAND.name}
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:16px 32px 32px 32px;font-size:15px;line-height:1.6;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:#fafafa;border-top:1px solid ${BRAND.border};font-size:12px;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;text-align:center;">
              Need help? Contact
              <a href="mailto:${BRAND.support}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.support}</a><br/>
              &copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

/** Bullet-proof button (works in Outlook via VML) */
const button = (url, label) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;">
    <tr>
      <td align="center" bgcolor="${BRAND.primary}" style="border-radius:8px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
          href="${url}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="17%" stroke="f" fillcolor="${BRAND.primary}">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;">${label}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <a href="${url}" target="_blank" rel="noopener"
           style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;background:${BRAND.primary};border-radius:8px;text-decoration:none;">
          ${label}
        </a>
        <!--<![endif]-->
      </td>
    </tr>
  </table>`;

const sendVerificationEmail = async (user, token) => {
  const url = `${process.env.CLIENT_URL}/verify-email.html?token=${encodeURIComponent(token)}`;

  const bodyHtml = `
    <h1 style="margin:0 0 16px 0;font-size:22px;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;">
      Welcome to ${BRAND.name}
    </h1>
    <p style="margin:0 0 12px 0;">Hi ${user.fullName},</p>
    <p style="margin:0 0 16px 0;">
      Thanks for signing up. Please confirm your email address to activate your account.
    </p>
    ${button(url, 'Verify My Email')}
    <p style="margin:16px 0 8px 0;font-size:13px;color:${BRAND.muted};">
      Or paste this link into your browser:
    </p>
    <p style="margin:0 0 16px 0;font-size:12px;word-break:break-all;">
      <a href="${url}" target="_blank" rel="noopener" style="color:${BRAND.primary};">${url}</a>
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${BRAND.muted};">
      This link expires in 24 hours. If you didn't sign up, you can safely ignore this email.
    </p>`;

  await sendEmail({
    to:      user.email,
    subject: `Verify your ${BRAND.name} account`,
    html:    baseLayout({
      preheader: `Confirm your email to activate your ${BRAND.name} account.`,
      title:     'Verify your email',
      bodyHtml
    }),
    text: `Hi ${user.fullName},\n\nVerify your ${BRAND.name} email:\n${url}\n\nThis link expires in 24 hours.`
  });
};

const sendPasswordResetEmail = async (user, token) => {
  const url = `${process.env.CLIENT_URL}/reset-password.html?token=${encodeURIComponent(token)}`;

  const bodyHtml = `
    <h1 style="margin:0 0 16px 0;font-size:22px;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;">
      Reset your password
    </h1>
    <p style="margin:0 0 12px 0;">Hi ${user.fullName},</p>
    <p style="margin:0 0 16px 0;">
      We received a request to reset your ${BRAND.name} password. Click the button below to choose a new one.
    </p>
    ${button(url, 'Reset Password')}
    <p style="margin:16px 0 8px 0;font-size:13px;color:${BRAND.muted};">
      Or paste this link into your browser:
    </p>
    <p style="margin:0 0 16px 0;font-size:12px;word-break:break-all;">
      <a href="${url}" target="_blank" rel="noopener" style="color:${BRAND.primary};">${url}</a>
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${BRAND.muted};">
      This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password won't change.
    </p>`;

  await sendEmail({
    to:      user.email,
    subject: `Reset your ${BRAND.name} password`,
    html:    baseLayout({
      preheader: `Reset your ${BRAND.name} password. Link expires in 1 hour.`,
      title:     'Reset your password',
      bodyHtml
    }),
    text: `Hi ${user.fullName},\n\nReset your ${BRAND.name} password:\n${url}\n\nThis link expires in 1 hour.`
  });
};

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };