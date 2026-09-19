/**
 * Which carrier places this workspace's calls.
 *
 * Two live at once and they are not interchangeable. Exotel is a carrier the
 * customer brings — their account, their caller id, configured in Integrations.
 * Vobiz is also customer-owned. Only an active, explicitly connected number
 * can select it; credentials alone are not proof of number ownership/routing.
 *
 * Written as a lookup rather than a setting on purpose. A workspace that has
 * connected a Vobiz number should not also have to tell the product that it
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
 * pending provider setup, or one that was released, cannot place calls, and
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
