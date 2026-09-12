/**
 * Which carrier places this workspace's calls.
 *
 * Two live at once and they are not interchangeable. Exotel is a carrier the
 * customer brings — their account, their caller id, configured in Integrations.
 * Vobiz is the one Vaani resells: the workspace is a sub-account, and the
 * number it calls from is one Vaani handed it, which is why the choice is made
 * from `phone_numbers` rather than from whichever credentials happen to exist.
 *
 * Written as a lookup rather than a setting on purpose. A workspace that has
 * been given a Vobiz number should not also have to tell the product that it
 * has one, and a setting that can disagree with the numbers table is a setting
 * that eventually does.
 */

type Db = {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T>(): Promise<T | null>;
    };
  };
};

export type CarrierChoice =
  | { carrier: 'vobiz'; fromNumber: string }
  | { carrier: 'exotel'; fromNumber: null };

/**
 * The first active Vobiz number that may dial out, or Exotel.
 *
 * `status = 'active'` is the whole test on the Vobiz side: a number still in
 * KYC, or one that was released, is not something to place a call from, and
 * their API refuses a `from` the sub-account does not own — so guessing here
 * would turn a configuration problem into a failed call.
 */
export async function chooseCarrier(
  db: Db,
  organizationId: string,
): Promise<CarrierChoice> {
  const number = await db
    .prepare(`SELECT phone_number FROM phone_numbers
      WHERE organization_id = ? AND provider_code = 'vobiz' AND status = 'active'
        AND direction != 'inbound'
      ORDER BY created_at LIMIT 1`)
    .bind(organizationId)
    .first<{ phone_number: string }>();
  return number?.phone_number
    ? { carrier: 'vobiz', fromNumber: number.phone_number }
    : { carrier: 'exotel', fromNumber: null };
}
