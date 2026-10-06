import { prisma } from "@/lib/prisma";
import { sendWgcEmail } from "@/lib/email";

/** Days-since-first-eligible at which each successive nudge goes out — after
 * the array is exhausted, nudges continue every 30 days indefinitely until
 * the church clears the milestone (or WGC intervenes manually). */
const CADENCE_DAYS = [1, 3, 7, 14, 30];

function isDueForNextNudge(row: { sequenceStep: number; createdAt: Date; lastSentAt: Date | null }, now: Date): boolean {
  const dayOffset = row.sequenceStep < CADENCE_DAYS.length ? CADENCE_DAYS[row.sequenceStep] : CADENCE_DAYS[CADENCE_DAYS.length - 1] * (row.sequenceStep - CADENCE_DAYS.length + 2);
  const dueAt = new Date(row.createdAt.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  return now >= dueAt;
}

interface ChurchContext {
  id: string;
  name: string;
  primaryContactEmail: string;
}

function renderStepBlock(steps: string[]): string {
  return `
    <div style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin:0 0 20px;">
      ${steps
        .map(
          (step, i) => `
        <div style="display:flex;align-items:flex-start;gap:8px;${i < steps.length - 1 ? "margin-bottom:8px;" : ""}">
          <span style="font-size:13px;color:#0B5DBC;font-weight:600;">${i + 1}</span>
          <span style="font-size:13px;color:#475569;">${step}</span>
        </div>`
        )
        .join("")}
    </div>`;
}

async function send(church: ChurchContext, emailType: string, subject: string, bodyHtml: string, badgeText: string) {
  const result = await sendWgcEmail({
    to: church.primaryContactEmail,
    subject,
    title: subject,
    badgeText,
    badgeColor: "#0B5DBC",
    bodyHtml,
    log: {
      churchId: church.id,
      category: "MERCHANT_NOTIFICATION",
      relatedEntityType: "MerchantLifecycleEmail",
      relatedEntityId: emailType,
    },
  });
  return result.success;
}

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "https://www.wgcpayments.com";

async function sendAccountActivation(church: ChurchContext) {
  const bodyHtml = `
    <p>Hi there,</p>
    <p>${church.name} was approved for WGC Payments, but you haven't signed in yet. Your dashboard is ready whenever you are — it only takes a minute to set your password and take a look around.</p>
    <p><a href="${appUrl()}/merchant/login" style="display:inline-block;background:#0B5DBC;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Sign in to your dashboard</a></p>
    <p style="color:#64748b;font-size:13px;">Need a hand getting set up? Just reply to this email.</p>`;
  return send(church, "ACCOUNT_ACTIVATION", "Your WGC account is ready — sign in to get started", bodyHtml, "Get Started");
}

async function sendGivingLinkSetup(church: ChurchContext) {
  const bodyHtml = `
    <p>Hi there,</p>
    <p>Your WGC account is active, but ${church.name} hasn't set up a giving link yet — that's the one thing standing between you and your first donation. It takes about five minutes.</p>
    ${renderStepBlock(["Go to Giving Links in your dashboard", "Create a link and set a title and amount options", "Share it by email, text, or on your website"])}
    <p><a href="${appUrl()}/merchant/giving-links" style="display:inline-block;background:#0B5DBC;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Create your giving link</a></p>
    <p style="color:#64748b;font-size:13px;">Need a hand? Just reply to this email.</p>`;
  return send(church, "GIVING_LINK_SETUP", "Let's get your giving link live", bodyHtml, "Get Started");
}

async function sendGivingLinkNoPayments(church: ChurchContext) {
  const bodyHtml = `
    <p>Hi there,</p>
    <p>${church.name} has a giving link set up, but no donations have come through it yet. A link only works once people actually see it — here are a few ways to put it in front of your donors.</p>
    ${renderStepBlock([
      "Share the link directly with your congregation or supporter list by email",
      "Send it by text — Giving Campaigns can text your giving link to a segment of your donor list in a few clicks",
      "Add it to your website, bulletin, or social media",
    ])}
    <p><a href="${appUrl()}/merchant/giving-links" style="display:inline-block;background:#0B5DBC;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">View your giving link</a></p>
    <p style="color:#64748b;font-size:13px;">Need a hand promoting it? Just reply to this email.</p>`;
  return send(church, "GIVING_LINK_NO_PAYMENTS", "Your giving link is live — let's get it in front of donors", bodyHtml, "Get Started");
}

async function sendTextingAnnouncement(church: ChurchContext) {
  const bodyHtml = `
    <p>Hi there,</p>
    <p>You can now send your giving link to donors by text, not just email. Pick a segment of your donor list, write a short message, and everyone gets their own tracked link to give from.</p>
    ${renderStepBlock(["Open Billing Plan and subscribe to Text Messaging", "Go to Giving Campaigns and choose Text", "Pick your donors and send"])}
    <p><a href="${appUrl()}/merchant/subscription" style="display:inline-block;background:#0B5DBC;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Set up text messaging</a></p>`;
  return send(church, "TEXTING_ANNOUNCEMENT", "New: text your giving link straight to donors", bodyHtml, "New Feature");
}

export interface LifecycleEmailRunResult {
  accountActivation: { checked: number; sent: number; completed: number };
  givingLinkSetup: { checked: number; sent: number; completed: number };
  givingLinkNoPayments: { checked: number; sent: number; completed: number };
  textingAnnouncement: { checked: number; sent: number };
}

/**
 * Runs all four lifecycle-email stages once. Designed to be safe to call
 * repeatedly (e.g. a daily cron): each stage only touches churches actually
 * eligible for it right now, and completedAt/sequenceStep prevent duplicate
 * or premature sends. Never throws on a single church's failure — logs and
 * continues, so one bad row can't stop the whole batch.
 */
export async function runMerchantLifecycleEmails(now: Date = new Date()): Promise<LifecycleEmailRunResult> {
  const result: LifecycleEmailRunResult = {
    accountActivation: { checked: 0, sent: 0, completed: 0 },
    givingLinkSetup: { checked: 0, sent: 0, completed: 0 },
    givingLinkNoPayments: { checked: 0, sent: 0, completed: 0 },
    textingAnnouncement: { checked: 0, sent: 0 },
  };

  // --- Stage 1: approved, never logged in ---------------------------------
  const neverLoggedInOwners = await prisma.user.findMany({
    where: { role: "owner", disabledAt: null, lastLoginAt: null, churchId: { not: null } },
    select: { churchId: true },
  });
  const activationChurchIds = Array.from(new Set(neverLoggedInOwners.map((u) => u.churchId!).filter(Boolean)));
  result.accountActivation.checked = activationChurchIds.length;

  for (const churchId of activationChurchIds) {
    const owner = await prisma.user.findFirst({ where: { churchId, role: "owner", disabledAt: null }, select: { lastLoginAt: true } });
    if (owner?.lastLoginAt) continue; // logged in between the query above and now

    const row = await prisma.merchantLifecycleEmail.upsert({
      where: { churchId_emailType: { churchId, emailType: "ACCOUNT_ACTIVATION" } },
      create: { churchId, emailType: "ACCOUNT_ACTIVATION" },
      update: {},
    });
    if (row.completedAt) continue;
    if (!isDueForNextNudge(row, now)) continue;

    const church = await prisma.church.findUnique({ where: { id: churchId }, select: { id: true, name: true, primaryContactEmail: true } });
    if (!church) continue;

    try {
      const ok = await sendAccountActivation(church);
      if (ok) {
        await prisma.merchantLifecycleEmail.update({ where: { id: row.id }, data: { sequenceStep: { increment: 1 }, lastSentAt: now } });
        result.accountActivation.sent++;
      }
    } catch (err) {
      console.error(`Lifecycle email (ACCOUNT_ACTIVATION) failed for church ${churchId}:`, err);
    }
  }

  // Mark completed for anyone who logged in since being enrolled.
  const activationCompletions = await prisma.merchantLifecycleEmail.findMany({
    where: { emailType: "ACCOUNT_ACTIVATION", completedAt: null },
    select: { id: true, churchId: true },
  });
  for (const row of activationCompletions) {
    const owner = await prisma.user.findFirst({ where: { churchId: row.churchId, role: "owner" }, select: { lastLoginAt: true } });
    if (owner?.lastLoginAt) {
      await prisma.merchantLifecycleEmail.update({ where: { id: row.id }, data: { completedAt: now } });
      result.accountActivation.completed++;
    }
  }

  // --- Stage 2: logged in, no giving link ---------------------------------
  const loggedInOwners = await prisma.user.findMany({
    where: { role: "owner", disabledAt: null, lastLoginAt: { not: null }, churchId: { not: null } },
    select: { churchId: true },
  });
  const loggedInChurchIds = Array.from(new Set(loggedInOwners.map((u) => u.churchId!).filter(Boolean)));

  const linkCounts = await prisma.givingLink.groupBy({ by: ["churchId"], where: { churchId: { in: loggedInChurchIds } }, _count: true });
  const churchesWithLinks = new Set(linkCounts.map((c) => c.churchId));
  const noLinkChurchIds = loggedInChurchIds.filter((id) => !churchesWithLinks.has(id));
  result.givingLinkSetup.checked = noLinkChurchIds.length;

  for (const churchId of noLinkChurchIds) {
    const row = await prisma.merchantLifecycleEmail.upsert({
      where: { churchId_emailType: { churchId, emailType: "GIVING_LINK_SETUP" } },
      create: { churchId, emailType: "GIVING_LINK_SETUP" },
      update: {},
    });
    if (row.completedAt) continue;
    if (!isDueForNextNudge(row, now)) continue;

    const church = await prisma.church.findUnique({ where: { id: churchId }, select: { id: true, name: true, primaryContactEmail: true } });
    if (!church) continue;

    try {
      const ok = await sendGivingLinkSetup(church);
      if (ok) {
        await prisma.merchantLifecycleEmail.update({ where: { id: row.id }, data: { sequenceStep: { increment: 1 }, lastSentAt: now } });
        result.givingLinkSetup.sent++;
      }
    } catch (err) {
      console.error(`Lifecycle email (GIVING_LINK_SETUP) failed for church ${churchId}:`, err);
    }
  }

  const givingLinkCompletions = await prisma.merchantLifecycleEmail.findMany({
    where: { emailType: "GIVING_LINK_SETUP", completedAt: null },
    select: { id: true, churchId: true },
  });
  for (const row of givingLinkCompletions) {
    const hasLink = await prisma.givingLink.findFirst({ where: { churchId: row.churchId }, select: { id: true } });
    if (hasLink) {
      await prisma.merchantLifecycleEmail.update({ where: { id: row.id }, data: { completedAt: now } });
      result.givingLinkSetup.completed++;
    }
  }

  // --- Stage 3: has a giving link, zero successful payments ---------------
  const paidChurchIds = new Set(
    (await prisma.payment.groupBy({ by: ["churchId"], where: { churchId: { in: Array.from(churchesWithLinks) }, status: "SUCCEEDED" }, _count: true })).map((p) => p.churchId)
  );
  const unpaidChurchIds = Array.from(churchesWithLinks).filter((id) => !paidChurchIds.has(id));
  result.givingLinkNoPayments.checked = unpaidChurchIds.length;

  for (const churchId of unpaidChurchIds) {
    const row = await prisma.merchantLifecycleEmail.upsert({
      where: { churchId_emailType: { churchId, emailType: "GIVING_LINK_NO_PAYMENTS" } },
      create: { churchId, emailType: "GIVING_LINK_NO_PAYMENTS" },
      update: {},
    });
    if (row.completedAt) continue;
    if (!isDueForNextNudge(row, now)) continue;

    const church = await prisma.church.findUnique({ where: { id: churchId }, select: { id: true, name: true, primaryContactEmail: true } });
    if (!church) continue;

    try {
      const ok = await sendGivingLinkNoPayments(church);
      if (ok) {
        await prisma.merchantLifecycleEmail.update({ where: { id: row.id }, data: { sequenceStep: { increment: 1 }, lastSentAt: now } });
        result.givingLinkNoPayments.sent++;
      }
    } catch (err) {
      console.error(`Lifecycle email (GIVING_LINK_NO_PAYMENTS) failed for church ${churchId}:`, err);
    }
  }

  const noPaymentsCompletions = await prisma.merchantLifecycleEmail.findMany({
    where: { emailType: "GIVING_LINK_NO_PAYMENTS", completedAt: null },
    select: { id: true, churchId: true },
  });
  for (const row of noPaymentsCompletions) {
    const paid = await prisma.payment.findFirst({ where: { churchId: row.churchId, status: "SUCCEEDED" }, select: { id: true } });
    if (paid) {
      await prisma.merchantLifecycleEmail.update({ where: { id: row.id }, data: { completedAt: now } });
      result.givingLinkNoPayments.completed++;
    }
  }

  // --- Stage 4: one-time texting-feature announcement ---------------------
  // Any church that has ever created a giving link (i.e., an actually-active
  // merchant, not a brand-new signup still working through the earlier
  // stages) and hasn't been sent this one-time announcement yet.
  const activeChurchIds = Array.from(churchesWithLinks);
  result.textingAnnouncement.checked = activeChurchIds.length;

  for (const churchId of activeChurchIds) {
    const existing = await prisma.merchantLifecycleEmail.findUnique({ where: { churchId_emailType: { churchId, emailType: "TEXTING_ANNOUNCEMENT" } } });
    if (existing) continue; // already sent (or already enrolled) — one-time only

    const church = await prisma.church.findUnique({ where: { id: churchId }, select: { id: true, name: true, primaryContactEmail: true } });
    if (!church) continue;

    try {
      const ok = await sendTextingAnnouncement(church);
      if (ok) {
        // Only recorded on a confirmed send — a failed attempt leaves no row,
        // so the next cron run retries rather than silently skipping this
        // church forever.
        await prisma.merchantLifecycleEmail.create({
          data: { churchId, emailType: "TEXTING_ANNOUNCEMENT", sequenceStep: 1, lastSentAt: now, completedAt: now },
        });
        result.textingAnnouncement.sent++;
      }
    } catch (err) {
      console.error(`Lifecycle email (TEXTING_ANNOUNCEMENT) failed for church ${churchId}:`, err);
    }
  }

  return result;
}
