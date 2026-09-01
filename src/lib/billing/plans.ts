/**
 * Plan catalogue.
 *
 * Limits are data, not code branches — adding a plan or changing a quota is an
 * edit here, and every enforcement point reads from this table. Prices are
 * display values only; the platform charges nothing until a payment provider is
 * connected, and the UI says so rather than showing a dead checkout button.
 */

export type PlanId = 'free' | 'pro' | 'premium' | 'enterprise';

export type UsageMetric = 'interviews' | 'resume_analyses' | 'ai_questions' | 'voice_interviews';

/** null means unlimited. */
export type Quota = number | null;

export interface PlanFeatures {
  advancedAnalytics: boolean;
  /** Adaptive follow-ups and difficulty scaling beyond the basic ladder. */
  fullAdaptiveEngine: boolean;
  exportReports: boolean;
  prioritySupport: boolean;
  teamSeats: boolean;
  /** Gated because voice needs a speech provider configured. */
  voiceInterviews: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in minor units (cents). Display only. */
  priceMonthly: number;
  priceYearly: number;
  currency: 'USD';
  highlight: boolean;
  quotas: Record<UsageMetric, Quota>;
  features: PlanFeatures;
  /** Copy for the pricing page. */
  bullets: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Run a real interview and see where you stand.',
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'USD',
    highlight: false,
    quotas: {
      interviews: 3,
      resume_analyses: 2,
      ai_questions: 40,
      voice_interviews: 0,
    },
    features: {
      advancedAnalytics: false,
      fullAdaptiveEngine: true,
      exportReports: false,
      prioritySupport: false,
      teamSeats: false,
      voiceInterviews: false,
    },
    bullets: [
      '3 interviews per month',
      '2 CV analyses per month',
      'Adaptive questioning and follow-ups',
      'Full evaluation report with skill breakdown',
      'Progress tracking across interviews',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'Prepare seriously for a specific role.',
    priceMonthly: 1900,
    priceYearly: 19000,
    currency: 'USD',
    highlight: true,
    quotas: {
      interviews: 30,
      resume_analyses: 25,
      ai_questions: 400,
      voice_interviews: 0,
    },
    features: {
      advancedAnalytics: true,
      fullAdaptiveEngine: true,
      exportReports: true,
      prioritySupport: false,
      teamSeats: false,
      voiceInterviews: false,
    },
    bullets: [
      '30 interviews per month',
      '25 CV analyses per month',
      'Advanced analytics and skill radar',
      'Personalised improvement plans',
      'Export reports',
    ],
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    tagline: 'Unlimited practice across every interview type.',
    priceMonthly: 4900,
    priceYearly: 49000,
    currency: 'USD',
    highlight: false,
    quotas: {
      interviews: null,
      resume_analyses: null,
      ai_questions: null,
      voice_interviews: 20,
    },
    features: {
      advancedAnalytics: true,
      fullAdaptiveEngine: true,
      exportReports: true,
      prioritySupport: true,
      teamSeats: false,
      voiceInterviews: true,
    },
    bullets: [
      'Unlimited interviews',
      'Unlimited CV analyses',
      'Voice interviews when a speech provider is configured',
      'Priority support',
      'Full analytics history',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For bootcamps, universities and talent teams.',
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'USD',
    highlight: false,
    quotas: {
      interviews: null,
      resume_analyses: null,
      ai_questions: null,
      voice_interviews: null,
    },
    features: {
      advancedAnalytics: true,
      fullAdaptiveEngine: true,
      exportReports: true,
      prioritySupport: true,
      teamSeats: true,
      voiceInterviews: true,
    },
    bullets: [
      'Everything in Premium',
      'Team seats and cohort reporting',
      'Custom interview types',
      'SSO and data residency options',
      'Dedicated support',
    ],
  },
};

export const PLAN_ORDER: readonly PlanId[] = ['free', 'pro', 'premium', 'enterprise'];

export function getPlan(id: string): Plan {
  return PLANS[(id as PlanId)] ?? PLANS.free;
}

/** Display price, e.g. "$19". Enterprise is quoted rather than listed. */
export function formatPrice(plan: Plan, period: 'monthly' | 'yearly'): string {
  if (plan.id === 'enterprise') return 'Custom';
  const cents = period === 'monthly' ? plan.priceMonthly : plan.priceYearly;
  if (cents === 0) return 'Free';
  return `$${Math.round(cents / 100)}`;
}

export const METRIC_LABELS: Record<UsageMetric, string> = {
  interviews: 'Interviews',
  resume_analyses: 'CV analyses',
  ai_questions: 'AI questions',
  voice_interviews: 'Voice interviews',
};
