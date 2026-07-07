import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface WgcEmailOptions {
  to: string;
  subject: string;
  previewText?: string;
  title: string;
  badgeText?: string;
  badgeColor?: string; // e.g. "#C99A2E" or "#10B981"
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
}

export async function sendWgcEmail({
  to,
  subject,
  previewText,
  title,
  badgeText,
  badgeColor = "#0B5DBC",
  bodyHtml,
  ctaText,
  ctaUrl
}: WgcEmailOptions) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not set. Email not sent.");
    return { success: false, error: "Missing API Key" };
  }

  const logoUrl = "https://wgcpayments.com/wgc-logo.png";
  
  // HTML Template
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #F8FBFF; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      ${previewText ? `<div style="display: none; max-height: 0px; overflow: hidden;">${previewText}</div>` : ''}
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F8FBFF; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(11, 19, 32, 0.05);">
              
              <!-- Header with Logo -->
              <tr>
                <td style="padding: 40px 40px 20px 40px; text-align: center; border-bottom: 1px solid #F0F4F8;">
                  <img src="${logoUrl}" alt="WGC Payments" style="height: 40px; max-width: 100%;" />
                </td>
              </tr>
              
              <!-- Main Content -->
              <tr>
                <td style="padding: 40px;">
                  
                  ${badgeText ? `
                  <div style="text-align: center; margin-bottom: 20px;">
                    <span style="display: inline-block; padding: 6px 12px; background-color: ${badgeColor}15; color: ${badgeColor}; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; border-radius: 20px;">
                      ${badgeText}
                    </span>
                  </div>
                  ` : ''}

                  <h1 style="color: #0B1320; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 24px 0;">
                    ${title}
                  </h1>

                  <div style="color: #4A5568; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
                    ${bodyHtml}
                  </div>

                  ${ctaText && ctaUrl ? `
                  <div style="text-align: center; margin-bottom: 30px;">
                    <a href="${ctaUrl}" style="display: inline-block; padding: 14px 28px; background-color: #0B5DBC; color: #FFFFFF; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                      ${ctaText}
                    </a>
                  </div>
                  ` : ''}

                  <!-- Support Box -->
                  <div style="background-color: #F8FBFF; border-left: 4px solid #C99A2E; padding: 20px; border-radius: 4px; margin-top: 40px;">
                    <h3 style="margin: 0 0 10px 0; color: #0B1320; font-size: 16px;">Need help?</h3>
                    <p style="margin: 0; color: #4A5568; font-size: 14px; line-height: 1.5;">
                      Contact WGC Payments Support at <a href="mailto:support@wgcpayments.com" style="color: #0B5DBC; text-decoration: none; font-weight: 600;">support@wgcpayments.com</a>
                    </p>
                  </div>
                  
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #0B1320; padding: 30px 40px; text-align: center;">
                  <p style="margin: 0; color: #A0AEC0; font-size: 14px; line-height: 1.5;">
                    Thank you,<br/>
                    <strong>WGC Payments Support Team</strong><br/>
                    <a href="mailto:support@wgcpayments.com" style="color: #A0AEC0; text-decoration: none;">support@wgcpayments.com</a>
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  // Plain Text Fallback
  // Strip simple HTML tags from bodyHtml for the text version
  const cleanBody = bodyHtml
    .replace(/<br\s*[\/]?>/gi, '\\n')
    .replace(/<\/p>/gi, '\\n\\n')
    .replace(/<[^>]+>/g, '')
    .trim();

  const text = `
${title}
${badgeText ? `[Status: ${badgeText}]` : ''}

${cleanBody}

${ctaText && ctaUrl ? `${ctaText}: ${ctaUrl}\n` : ''}

Need help? Contact WGC Payments Support at support@wgcpayments.com

Thank you,
WGC Payments Support Team
support@wgcpayments.com
  `.trim();

  try {
    const data = await resend.emails.send({
      from: "WGC Payments <no-reply@wgcpayments.com>",
      replyTo: "support@wgcpayments.com",
      to,
      subject,
      html,
      text,
    });

    console.log("WGC Email sent successfully:", data);
    return { success: true, data };
  } catch (error) {
    console.error("Failed to send WGC email:", error);
    return { success: false, error };
  }
}
