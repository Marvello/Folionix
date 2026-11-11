import 'dotenv/config'
import nodemailer from 'nodemailer'
import { Marked } from 'marked'
import { escapeHtml } from '../../../lib/format'

// Markdown here includes LLM- and DB-derived text, so the HTML part must not
// carry raw HTML, javascript:/data: links, or remote images (tracking pixels).
const SAFE_HREF = /^(https?:|mailto:)/i
const emailMarked = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens)
      if (!SAFE_HREF.test(href)) return label
      const t = title ? ` title="${escapeHtml(title)}"` : ''
      return `<a href="${escapeHtml(href)}"${t}>${label}</a>`
    },
    image: ({ text }) => escapeHtml(text),
  },
})

/** Markdown → email-safe HTML. Exported for tests. */
export async function renderEmailHtml(markdown: string): Promise<string> {
  return emailMarked.parse(markdown)
}

// ── EMAIL (Brevo SMTP) ──────────────────────────────────────────────────────
// Best-effort delivery: when SMTP env is not configured the send is skipped
// with a warning so pipelines never fail on email alone.

export interface EmailAttachment {
  filename: string
  content: string
}

// Canonical names are SMTP_HOST/SMTP_USER/SMTP_PASS; the alternates
// (SMTP_SERVER, SMTP_USERNAME/SMPT_USERNAME, SMTP_PASSWORD) match what an
// existing .env may already carry.
function smtpEnv(): { host: string; port: number; user?: string; pass?: string; to?: string; from?: string } {
  return {
    host: process.env.SMTP_HOST ?? process.env.SMTP_SERVER ?? 'smtp-relay.brevo.com',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? process.env.SMTP_USERNAME ?? process.env.SMPT_USERNAME,
    pass: process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD,
    to: process.env.EMAIL_TO,
    from: process.env.EMAIL_FROM,
  }
}

export function emailConfigured(): boolean {
  const { user, pass, to } = smtpEnv()
  return Boolean(user && pass && to)
}

export async function sendEmailMarkdown(
  subject: string,
  markdown: string,
  attachments: EmailAttachment[] = [],
): Promise<boolean> {
  const cfg = smtpEnv()
  if (!emailConfigured()) {
    console.warn('[email] SMTP user/pass or EMAIL_TO not set — skipping email')
    return false
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: false, // Brevo uses STARTTLS on 587
    auth: { user: cfg.user, pass: cfg.pass },
  })

  const html = await renderEmailHtml(markdown)

  try {
    await transporter.sendMail({
      from: cfg.from ?? cfg.user,
      to: cfg.to,
      subject,
      text: markdown,
      html,
      attachments,
    })
    console.log(`[email] sent: ${subject}`)
    return true
  } catch (err) {
    console.error('[email] send failed:', err instanceof Error ? err.message : err)
    return false
  }
}
