/**
 * Admin: the invitations list (`/admin/invitations`), behind its status chips.
 *
 * The chip that is pressed is the table's `status` prop, and the route keeps it
 * in the address (`?status=`). Here each card holds it in state, started from
 * the chip the card is about.
 *
 * `onResend` (the Send again button) and `onRevoke` (Withdraw) are real props
 * that the route backs with admin client calls. The playground has no server, so these stand-ins wait a moment
 * and resolve, which is enough to show the busy state; one card's stand-in
 * rejects, to show the failure line. Nothing is removed from a list: the
 * table renders the `invites` it is given, and the route is what reloads them.
 */
import { useState, type ReactElement } from 'react';

import { InviteTable } from '#app/components/admin/invite-table';
import type { InviteView } from '#app/lib/admin/admin-wire';
import { DEFAULT_INVITE_STATUS, type InviteStatusFilter } from '#app/lib/admin/invite-filter';
import { Card, Group, Section, type SectionDef } from '../layout';
import { PLAYGROUND_NOW } from '../fixtures/clock';
import { MIXED_INVITES, NO_INVITES, ONLY_PENDING_INVITES } from '../fixtures/invites';

export const DEF: SectionDef = {
  id: 'admin-invitations',
  title: 'Admin: invitations',
  intent:
    'The invitations list at /admin/invitations, one card per chip. The Send again and Withdraw buttons are the real ones; their handlers are stand-ins because the playground has no server.',
};

const STAND_IN_DELAY_MS = 700;

/** Waits a moment and resolves, in place of a call to the admin client. */
async function resolveAfterDelay(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, STAND_IN_DELAY_MS));
}

/** Waits a moment and fails, in place of a call the service answers with an error. */
async function rejectAfterDelay(): Promise<void> {
  await resolveAfterDelay();
  throw new Error('The playground has no server');
}

interface InviteCardProps {
  invites: InviteView[];
  initialStatus?: InviteStatusFilter;
  onResend?: (input: { id: number }) => Promise<void>;
}

/** The table with its chip held in state, as the route holds it in the address. */
function InviteTableDemo({
  invites,
  initialStatus = DEFAULT_INVITE_STATUS,
  onResend = resolveAfterDelay,
}: InviteCardProps): ReactElement {
  const [status, setStatus] = useState(initialStatus);
  return (
    <InviteTable
      invites={invites}
      status={status}
      onStatusChange={setStatus}
      now={PLAYGROUND_NOW}
      onResend={onResend}
      onRevoke={resolveAfterDelay}
    />
  );
}

export default function AdminInvitationsSection(): ReactElement {
  return (
    <Section def={DEF}>
      <Group title="Chips">
        <Card
          state="invites-pending"
          label="Pending (the default)"
          reach="Open /admin/invitations. Three of these are open: one with time to spare, one with two days left in amber, one out today. The administrator invite is open too."
        >
          <InviteTableDemo invites={MIXED_INVITES} />
        </Card>
        <Card
          state="invites-expired"
          label="Expired"
          reach="Press the Expired chip on /admin/invitations. An expired invite says when it ended and can be sent again; the second one lost its address to the retention sweep and has no Send again button."
        >
          <InviteTableDemo invites={MIXED_INVITES} initialStatus="expired" />
        </Card>
        <Card
          state="invites-revoked"
          label="Revoked"
          reach="Withdraw an open invitation, then press the Revoked chip. It says nothing about expiry and offers no button."
        >
          <InviteTableDemo invites={MIXED_INVITES} initialStatus="revoked" />
        </Card>
        <Card
          state="invites-accepted"
          label="Accepted"
          reach="Press the Accepted chip after someone has used their link. It says nothing about expiry and offers no button."
        >
          <InviteTableDemo invites={MIXED_INVITES} initialStatus="redeemed" />
        </Card>
        <Card
          state="invites-all"
          label="All"
          reach="Press the All chip on /admin/invitations. Newest first, every state in one list."
          span={2}
        >
          <InviteTableDemo invites={MIXED_INVITES} initialStatus="all" />
        </Card>
      </Group>
      <Group title="Empty and failing">
        <Card
          state="invites-none-sent"
          label="No invitation was ever sent"
          reach="Open /admin/invitations on a new instance."
        >
          <InviteTableDemo invites={NO_INVITES} />
        </Card>
        <Card
          state="invites-expired-chip-empty"
          label="A chip with nothing behind it"
          reach="Press the Expired chip when no invitation has expired. Each chip has its own sentence."
        >
          <InviteTableDemo invites={ONLY_PENDING_INVITES} initialStatus="expired" />
        </Card>
        <Card
          state="invites-send-again-fails"
          label="Send again fails"
          reach="Press Send again while the service answers an error, for example while it is down. Press it here to see the failure line."
          note="The Send again handler rejects after a moment, on purpose."
        >
          <InviteTableDemo invites={ONLY_PENDING_INVITES} onResend={rejectAfterDelay} />
        </Card>
      </Group>
    </Section>
  );
}
