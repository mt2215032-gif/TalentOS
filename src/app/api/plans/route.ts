import { NextResponse } from 'next/server';
import { PLANS, PLAN_ORDER } from '@/lib/billing/plans';

export const runtime = 'nodejs';

/** Public plan catalogue, used by the pricing page. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    data: { plans: PLAN_ORDER.map((id) => PLANS[id]) },
  });
}
