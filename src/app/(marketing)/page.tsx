import Link from 'next/link';
import type { Metadata } from 'next';
import { MarketingNav, Logo } from '@/components/marketing/nav';
import { Badge, Card, buttonClass } from '@/components/ui/primitives';
import { PLANS, PLAN_ORDER, formatPrice } from '@/lib/billing/plans';
import { INTERVIEW_TYPE_LABELS } from '@/lib/schemas/domain';
import { DashboardPreview } from '@/components/marketing/preview';

export const metadata: Metadata = {
  title: 'Practice interviews with an AI that thinks like a real interviewer',
};

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Features />
        <InterviewTypes />
        <Evaluation />
        <Preview />
        <WhyThis />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className = '',
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`border-t border-[var(--border)] py-16 sm:py-20 ${className}`}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          {eyebrow ? (
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-[var(--text)] sm:text-[32px]">
            {title}
          </h2>
          {description ? (
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">{description}</p>
          ) : null}
        </div>
        {children ? <div className="mt-10">{children}</div> : null}
      </div>
    </section>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-[0.55]" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
        <div className="max-w-3xl">
          <Badge tone="accent" className="animate-fade-in">
            Adaptive interview engine
          </Badge>
          <h1 className="animate-fade-rise mt-5 text-[34px] font-semibold leading-[1.08] tracking-tight text-[var(--text)] sm:text-[52px]">
            Practice interviews with an AI that thinks like a real interviewer.
          </h1>
          <p className="animate-fade-rise mt-5 max-w-2xl text-[16px] leading-relaxed text-[var(--text-muted)] sm:text-[18px]" style={{ animationDelay: '60ms' }}>
            TalentOS reads your CV and the job description, then runs an interview that follows
            the thread of your answers — pressing where you are vague, going deeper where you are
            strong. At the end you get an evaluation built from evidence, not encouragement.
          </p>
          <div className="animate-fade-rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: '120ms' }}>
            <Link href="/register" className={buttonClass('primary', 'lg')}>
              Start your first interview
            </Link>
            <a href="#how-it-works" className={buttonClass('secondary', 'lg')}>
              See how it works
            </a>
          </div>
          <p className="animate-fade-rise mt-4 text-[13px] text-[var(--text-subtle)]" style={{ animationDelay: '160ms' }}>
            Three interviews free every month. No card required.
          </p>
        </div>

        <dl className="animate-fade-rise mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4" style={{ animationDelay: '200ms' }}>
          {[
            ['6', 'interview formats'],
            ['4', 'difficulty levels'],
            ['9', 'scored dimensions per answer'],
            ['0', 'fixed question lists'],
          ].map(([value, label]) => (
            <div key={label} className="bg-[var(--surface)] px-4 py-5">
              <dt className="text-[24px] font-semibold tracking-tight text-[var(--text)]">{value}</dt>
              <dd className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Problem() {
  const problems = [
    {
      title: 'Question lists do not interview you',
      body: 'Reading fifty common questions tells you nothing about how you answer under follow-up. Real interviewers do not read from a list — they pull on whatever thread you give them.',
    },
    {
      title: 'Nobody tells you why you failed',
      body: 'Rejections arrive as one sentence, weeks late. The gap between what you said and what the interviewer needed to hear stays invisible, so you repeat it.',
    },
    {
      title: 'Generic feedback changes nothing',
      body: '"Be more specific" is not an action. Improvement needs to know which answer was thin, what was missing from it, and what to do this week instead.',
    },
  ];

  return (
    <Section
      eyebrow="The problem"
      title="Interview preparation is mostly guesswork"
      description="Candidates practise by reading. Then they sit in a real interview and discover that the hard part was never the first question — it was the third follow-up."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {problems.map((problem) => (
          <Card key={problem.title}>
            <h3 className="text-sm font-semibold text-[var(--text)]">{problem.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">{problem.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Upload your CV',
      body: 'A PDF or Word document is parsed into structured facts: skills, roles, projects, and the specific claims worth testing.',
    },
    {
      n: '02',
      title: 'Paste the job description',
      body: 'The posting becomes a skill matrix — every requirement graded as required or preferred, and weighted by how central it is to the role.',
    },
    {
      n: '03',
      title: 'The interview adapts',
      body: 'Questions are chosen turn by turn from what you just said. A vague answer earns a request for specifics; a strong one earns a harder question.',
    },
    {
      n: '04',
      title: 'Read the evaluation',
      body: 'Scores across six dimensions, a per-skill breakdown with the evidence behind each, and a question-by-question account of what was missing.',
    },
    {
      n: '05',
      title: 'Work the plan',
      body: 'A week-by-week plan ordered by which gap costs you the most, with a success criterion you can check yourself.',
    },
    {
      n: '06',
      title: 'Measure the change',
      body: 'Every interview is scored the same way, so your progression is a line you can actually read rather than a feeling.',
    },
  ];

  return (
    <Section
      id="how-it-works"
      eyebrow="How it works"
      title="From CV to a scored interview in a few minutes"
      description="Every step feeds the next. The interview is only as sharp as the context behind it, which is why the CV and the job description come first."
    >
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step) => (
          <li key={step.n}>
            <Card className="h-full">
              <span className="font-mono text-[12px] font-medium text-[var(--accent-text)]">{step.n}</span>
              <h3 className="mt-2 text-sm font-semibold text-[var(--text)]">{step.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">{step.body}</p>
            </Card>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Features() {
  const features = [
    {
      title: 'Follow-ups that come from your answer',
      body: 'The engine reads each answer for relevance, depth, evidence and hedging, then decides whether to clarify, ask for an example, push deeper, or test the concept underneath.',
    },
    {
      title: 'Difficulty that calibrates',
      body: 'Two strong answers and the questions get harder. Two weak ones and it eases back to find your actual level, rather than burying you.',
    },
    {
      title: 'CV claims get verified',
      body: 'If your CV says you built a recommender with scikit-learn, expect to be asked why that algorithm, how you evaluated it, and what happens at ten times the data.',
    },
    {
      title: 'Evidence-based scoring',
      body: 'Every score points at what you actually said. Where the interview did not gather enough evidence, the report says so instead of inventing confidence.',
    },
    {
      title: 'Skill gaps against a real job',
      body: 'Your demonstrated ability is compared to the weighted requirements of the posting you are targeting — not to a generic role.',
    },
    {
      title: 'Progress you can see',
      body: 'Scores, skill levels and gaps are tracked across every interview, so improvement shows up as a trend rather than a vibe.',
    },
  ];

  return (
    <Section
      id="features"
      eyebrow="Features"
      title="Built like an interviewer, not a chatbot"
      description="The difference is what happens after your answer."
      className="bg-[var(--bg-subtle)]"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <Card key={feature.title} className="h-full">
            <h3 className="text-sm font-semibold text-[var(--text)]">{feature.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">{feature.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function InterviewTypes() {
  const descriptions: Record<string, string> = {
    behavioral: 'Communication, leadership, teamwork, conflict and adaptability — scored on structure and evidence, not charm.',
    technical: 'Programming, data structures, algorithms, databases, SQL, ML and cloud, pitched at the stack the job actually names.',
    hr: 'Motivation, fit and the questions a screening call really turns on.',
    case_study: 'An ambiguous business problem, judged on how you structure it and what evidence you ask for.',
    system_design: 'Constraints first, then components, then the bottleneck — and what it costs to fix.',
    mixed: 'A panel format that moves between technical depth and behavioural evidence, like a real onsite.',
  };

  return (
    <Section
      id="interview-types"
      eyebrow="Interview types"
      title="Six formats, four difficulty levels"
      description="Pick the format the role actually uses. Each one has its own question frames, its own rubric, and its own idea of what a strong answer looks like."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(INTERVIEW_TYPE_LABELS).map(([key, label]) => (
          <Card key={key} className="h-full">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text)]">{label}</h3>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
              {descriptions[key]}
            </p>
          </Card>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {['Easy', 'Medium', 'Hard', 'Expert'].map((level) => (
          <Badge key={level}>{level}</Badge>
        ))}
      </div>
    </Section>
  );
}

function Evaluation() {
  const dimensions = [
    ['Technical knowledge', 'Is what you said correct, and does it go past the surface?'],
    ['Problem solving', 'Do you have a method, or are you guessing?'],
    ['Communication', 'Could a busy interviewer follow you the first time?'],
    ['Practical experience', 'Specifics, scale and measured outcomes — or generalities?'],
    ['Critical thinking', 'Do you reason about trade-offs and know what you do not know?'],
    ['Role fit', 'Against the weighted requirements of this specific posting.'],
  ];

  return (
    <Section
      eyebrow="AI evaluation"
      title="Six dimensions, scored independently"
      description="A candidate can communicate beautifully about work they clearly did not do. Scoring these separately is what makes that visible."
      className="bg-[var(--bg-subtle)]"
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <ul className="divide-y divide-[var(--border)]">
              {dimensions.map(([name, note]) => (
                <li key={name} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4">
                  <span className="w-44 shrink-0 text-[13px] font-semibold text-[var(--text)]">{name}</span>
                  <span className="text-[13px] leading-relaxed text-[var(--text-muted)]">{note}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card raised className="h-full">
          <h3 className="text-sm font-semibold text-[var(--text)]">Confidence is reported honestly</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
            Four short answers do not support a confident verdict. When the interview did not
            gather enough evidence, the report says so and marks the score provisional — which is
            more useful than a precise-looking number that was never earned.
          </p>
          <div className="mt-4 space-y-2">
            {[
              ['Strong hire', 'success'],
              ['Hire', 'accent'],
              ['Borderline', 'warning'],
              ['Not yet', 'danger'],
              ['Insufficient evidence', 'neutral'],
            ].map(([label, tone]) => (
              <div key={label} className="flex items-center gap-2">
                <Badge tone={tone as 'success' | 'accent' | 'warning' | 'danger' | 'neutral'}>{label}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Preview() {
  return (
    <Section
      eyebrow="Your dashboard"
      title="Every interview compared on the same scale"
      description="Because each interview is scored against the same rubric, the comparison between your first and your fifth is meaningful."
    >
      <DashboardPreview />
    </Section>
  );
}

function WhyThis() {
  const points = [
    ['Adaptive, not scripted', 'No fixed list of ten questions. What you are asked next depends on what you just said.'],
    ['Grounded in your documents', 'The interview is built from your CV and the posting you are targeting, so the questions are the ones that role would actually ask.'],
    ['Actionable by design', 'Every weakness comes with what a strong answer contains and the specific next step to get there.'],
    ['Your data stays yours', 'Interviews, CVs and reports are visible only to you. Administrators see usage, never your answers.'],
  ];

  return (
    <Section eyebrow="Why TalentOS" title="What makes this different" className="bg-[var(--bg-subtle)]">
      <div className="grid gap-4 sm:grid-cols-2">
        {points.map(([title, body]) => (
          <Card key={title}>
            <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">{body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function Pricing() {
  return (
    <Section
      id="pricing"
      eyebrow="Pricing"
      title="Start free, upgrade when you are interviewing for real"
      description="Limits are per calendar month and reset automatically."
    >
      <div className="grid gap-4 lg:grid-cols-4">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          return (
            <Card
              key={plan.id}
              raised={plan.highlight}
              className={`flex h-full flex-col ${plan.highlight ? 'ring-1 ring-[var(--accent-border)]' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--text)]">{plan.name}</h3>
                {plan.highlight ? <Badge tone="accent">Most popular</Badge> : null}
              </div>
              <p className="mt-1 min-h-[34px] text-[12px] leading-snug text-[var(--text-muted)]">
                {plan.tagline}
              </p>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-[30px] font-semibold tracking-tight text-[var(--text)]">
                  {formatPrice(plan, 'monthly')}
                </span>
                {plan.priceMonthly > 0 ? (
                  <span className="text-[13px] text-[var(--text-subtle)]">/month</span>
                ) : null}
              </p>
              <ul className="mt-4 flex-1 space-y-2">
                {plan.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
                    <svg className="mt-1 h-3 w-3 shrink-0 text-[var(--success)]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="m2 6 3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {bullet}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {plan.id === 'free' ? (
                  <Link href="/register" className={buttonClass('primary', 'md', 'w-full')}>
                    Start free
                  </Link>
                ) : plan.id === 'enterprise' ? (
                  <a href="mailto:sales@talentos.app" className={buttonClass('secondary', 'md', 'w-full')}>
                    Contact us
                  </a>
                ) : (
                  <span
                    className={`${buttonClass('secondary', 'md', 'w-full cursor-default opacity-70')}`}
                    aria-disabled="true"
                    title="Self-serve checkout is not connected on this deployment."
                  >
                    Coming soon
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-[12px] text-[var(--text-subtle)]">
        Paid plans are listed but self-serve checkout is not connected on this deployment, so those
        buttons are marked coming soon rather than pretending to take a payment.
      </p>
    </Section>
  );
}

function Faq() {
  const faqs = [
    {
      q: 'How is this different from asking a chatbot to interview me?',
      a: 'A chatbot answers the prompt in front of it. TalentOS keeps an interview state: which skills the job needs, which it has covered, how each answer scored, and whether the last one warrants a follow-up. That state is what makes the next question a decision rather than a continuation.',
    },
    {
      q: 'Does it actually read my CV?',
      a: 'Yes. The document is parsed into structured facts — skills, roles, projects, dates — and the specific claims worth testing are pulled out. If your CV says you built something, expect to be asked about the decisions behind it.',
    },
    {
      q: 'Can I see the scores during the interview?',
      a: 'No, and that is deliberate. Knowing your running score would change how you answer the rest, exactly as it would in a real interview. Everything is revealed in the report.',
    },
    {
      q: 'What if I do not have a job description?',
      a: 'You can run a general interview for a role title. It works, but the questions are less targeted — the skill matrix from a real posting is what makes the interview specific.',
    },
    {
      q: 'Are voice interviews available?',
      a: 'Not yet. The text interview is complete, and the application is built with provider interfaces for speech-to-text, text-to-speech and voice activity detection so voice slots in behind them. The product does not pretend to offer it before it works.',
    },
    {
      q: 'Who can see my interviews?',
      a: 'Only you. Every query is scoped to your account. Administrators see usage counts, scores in aggregate and system health — never your CV, your questions or your answers.',
    },
    {
      q: 'Which AI model does it use?',
      a: 'It is provider-agnostic. Anthropic, OpenAI and Google Gemini are all supported and selected by configuration, with cheaper models handling extraction and stronger ones handling evaluation.',
    },
  ];

  return (
    <Section id="faq" eyebrow="FAQ" title="Questions people actually ask" className="bg-[var(--bg-subtle)]">
      <div className="max-w-3xl divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
        {faqs.map((faq) => (
          <details key={faq.q} className="group px-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[14px] font-medium text-[var(--text)]">
              {faq.q}
              <svg
                className="h-4 w-4 shrink-0 text-[var(--text-subtle)] transition-transform group-open:rotate-45"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M8 3v10M3 8h10" />
              </svg>
            </summary>
            <p className="pb-4 pr-8 text-[13px] leading-relaxed text-[var(--text-muted)]">{faq.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function FinalCta() {
  return (
    <section className="border-t border-[var(--border)] py-20">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-[28px] font-semibold leading-tight tracking-tight text-[var(--text)] sm:text-[36px]">
          Find out how you actually interview.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--text-muted)]">
          One interview takes about fifteen minutes and ends with a report specific enough to act
          on this week.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/register" className={buttonClass('primary', 'lg')}>
            Start free
          </Link>
          <Link href="/login" className={buttonClass('secondary', 'lg')}>
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--border)] py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Logo size={22} />
          <span className="text-[13px] font-semibold tracking-tight">TalentOS</span>
          <span className="text-[12px] text-[var(--text-subtle)]">AI Recruitment Operating System</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-[var(--text-muted)]">
          <a href="#how-it-works" className="hover:text-[var(--text)]">How it works</a>
          <a href="#pricing" className="hover:text-[var(--text)]">Pricing</a>
          <a href="#faq" className="hover:text-[var(--text)]">FAQ</a>
          <Link href="/login" className="hover:text-[var(--text)]">Sign in</Link>
        </div>
      </div>
    </footer>
  );
}
