import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWgcEmail } from "@/lib/email";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const company = typeof body.company === "string" ? body.company.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!firstName || !lastName || !isValidEmail(email) || !message) {
      return NextResponse.json(
        { success: false, error: "First name, last name, a valid email, and a message are required." },
        { status: 400 }
      );
    }

    // Persisted before the email attempt — a submission must be recoverable
    // from the database even if Resend is down/misconfigured, not lost like
    // every prior submission was when this form had no backend at all.
    const inquiry = await prisma.contactInquiry.create({
      data: { firstName, lastName, email, phone: phone || null, company: company || null, role: role || null, message },
    });

    const notifyTo = process.env.SUPPORT_EMAIL || "support@wgcpayments.com";
    const result = await sendWgcEmail({
      to: notifyTo,
      subject: `New Inquiry: ${firstName} ${lastName}${company ? ` (${company})` : ""}`,
      title: "New Contact Inquiry",
      badgeText: "INQUIRY",
      badgeColor: "#0B5DBC",
      bodyHtml: `
        <p><strong>Name:</strong> ${firstName} ${lastName}</p>
        <p><strong>Email:</strong> ${email}</p>
        ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ""}
        ${company ? `<p><strong>Software Organization:</strong> ${company}</p>` : ""}
        ${role ? `<p><strong>Partnership Role:</strong> ${role}</p>` : ""}
        <div style="margin-top: 20px; padding: 15px; background-color: #F0F4F8; border-radius: 8px;">
          <p style="margin: 0; white-space: pre-wrap;">${message}</p>
        </div>
      `,
    });

    await prisma.contactInquiry.update({
      where: { id: inquiry.id },
      data: {
        emailSent: result.success,
        emailError: result.success ? null : JSON.stringify(result.error),
      },
    });

    // Confirmation to the submitter — separate from the staff notification
    // above, and never allowed to fail the request: the inquiry is already
    // saved, so a submitter-side email hiccup shouldn't look like a failed
    // submission to the person who just filled out the form.
    sendWgcEmail({
      to: email,
      subject: "We've received your message — WGC Payments",
      title: "Thanks for reaching out",
      badgeText: "Received",
      badgeColor: "#10B981",
      bodyHtml: `
        <p>Hi ${firstName},</p>
        <p>Thanks for contacting WGC Payments. We've received your message and someone from our team will get back to you shortly.</p>
        <div style="margin-top: 20px; padding: 15px; background-color: #F0F4F8; border-radius: 8px;">
          <p style="margin: 0; white-space: pre-wrap;">${message}</p>
        </div>
      `,
    }).catch((err) => console.error("[contact/route] Submitter confirmation email failed:", err));

    return NextResponse.json(
      { success: true, message: "Inquiry submitted successfully." },
      { status: 200 }
    );
  } catch (error: unknown) {
    // Log the real error server-side only — never expose internals to the browser.
    console.error("[contact/route] Unhandled error:", error);
    return NextResponse.json(
      { success: false, error: "Unable to submit inquiry. Please try again later." },
      { status: 500 }
    );
  }
}
