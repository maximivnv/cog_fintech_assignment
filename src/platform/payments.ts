import { getDb, inTx } from "./db";
import { InvalidInputError, InvalidStateError, NotFoundError } from "./errors";
import { newId, now } from "./ids";

/** Mock of the payment processor. */

export interface Charge {
  id: string;
  customer: string;
  description: string;
  amount_cents: number;
  refunded_cents: number;
  created_at: string;
}

export interface PaymentRefund {
  id: string;
  charge_id: string;
  amount_cents: number;
  created_at: string;
}

export function listCharges(): Charge[] {
  return getDb().prepare("SELECT * FROM charges ORDER BY created_at DESC").all() as unknown as Charge[];
}

export function getCharge(id: string): Charge | null {
  return (getDb().prepare("SELECT * FROM charges WHERE id = ?").get(id) as unknown as Charge | undefined) ?? null;
}

export function listRefundsForCharge(chargeId: string): PaymentRefund[] {
  return getDb()
    .prepare("SELECT * FROM payment_refunds WHERE charge_id = ? ORDER BY created_at")
    .all(chargeId) as unknown as PaymentRefund[];
}

/**
 * Record a refund against a charge and return the refund id. Stands in for the processor API.
 * Must be called from an action or approval handler (inside a transaction).
 */
export function refund(chargeId: string, amountCents: number): string {
  if (!inTx()) throw new InvalidStateError("refund() must be called inside an action or approval handler");
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new InvalidInputError(["amountCents must be a positive integer"]);
  }
  const db = getDb();
  const charge = getCharge(chargeId);
  if (!charge) throw new NotFoundError(`Charge ${chargeId} not found`);
  const remaining = charge.amount_cents - charge.refunded_cents;
  if (amountCents > remaining) {
    throw new InvalidStateError(`Refund of ${amountCents} cents exceeds remaining ${remaining} cents on ${chargeId}`);
  }
  const id = newId("re");
  db.prepare(
    "INSERT INTO payment_refunds (id, charge_id, amount_cents, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, chargeId, amountCents, now());
  db.prepare("UPDATE charges SET refunded_cents = refunded_cents + ? WHERE id = ?").run(amountCents, chargeId);
  return id;
}
