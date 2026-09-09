import { prisma } from "@/lib/prisma";
import { sendWgcEmail } from "@/lib/email";
import { NOTIFICATION_EVENTS, resolveNotificationDefault } from "@/lib/settings/notificationEvents";

/**
 * Sends a real event email only if the organization hasn't disabled it and
 * a real destination address exists. No-ops silently otherwise — this is a
 * best-effort notification, not a transactional flow, so it must never
 * throw and break the caller's main webhook/mutation path.
 *
 * Recipient: the church's own "owner" User account (Church.primaryOwnerUserId
 * -> User.email) — the real login the org actually checks, rather than a
 * separate supportEmail/financeEmail/primaryContactEmail field that can be
 * unset or stale. Falls back to that old contact-email chain only for
 * churches not yet backfilled with a primaryOwnerUserId (see Church's own
 * field comment — nullable during migration, backfilled via an explicit
 * reviewed report rather than silently assigned), or if the owner account
 * has been disabled.
 */
export async function notifyEvent(params: {
  churchId: string;
  eventKey: string;
  subject: string;
  title: string;
  badgeText: string;
  badgeColor: string;
  bodyHtml: string;
}) {
  try {
    const [church, preference] = await Promise.all([
      prisma.church.findUnique({
        where: { id: params.churchId },
        select: { primaryOwnerUserId: true, supportEmail: true, financeEmail: true, primaryContactEmail: true, name: true },
      }),
      prisma.notificationPreference.findUnique({
        where: { churchId_eventKey: { churchId: params.churchId, eventKey: params.eventKey } },
      }),
    ]);
    if (!church) return;

    const eventDef = NOTIFICATION_EVENTS.find((e) => e.key === params.eventKey);
    const emailEnabled = preference ? preference.emailEnabled : resolveNotificationDefault(eventDef ?? {}).emailEnabled;
    if (!emailEnabled) return;

    const owner = church.primaryOwnerUserId
      ? await prisma.user.findUnique({ where: { id: church.primaryOwnerUserId }, select: { email: true, disabledAt: true } })
      : null;
    const to = (owner && !owner.disabledAt ? owner.email : null) || church.supportEmail || church.financeEmail || church.primaryContactEmail;
    if (!to) return;

    await sendWgcEmail({
      to,
      subject: params.subject,
      title: params.title,
      badgeText: params.badgeText,
      badgeColor: params.badgeColor,
      bodyHtml: params.bodyHtml,
    });
  } catch (err) {
    console.error(`notifyEvent(${params.eventKey}) failed:`, err);
  }
}
