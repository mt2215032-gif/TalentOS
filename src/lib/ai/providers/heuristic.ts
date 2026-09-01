import type { z } from 'zod';
import { AiError, type AIProvider, type ModelTier, type StructuredRequest, type StructuredResult } from '@/lib/ai/types';
import { analyzeJobOffline, analyzeResumeOffline } from '@/lib/ai/heuristic/documents';
import { generateQuestionOffline } from '@/lib/ai/heuristic/questions';
import { analyzeAnswerOffline } from '@/lib/ai/heuristic/answer';
import { buildLearningPlanOffline, buildReportOffline } from '@/lib/ai/heuristic/report';
import { buildPlanOffline } from '@/lib/ai/heuristic/plan';
import type {
  HeuristicAnswerContext,
  HeuristicEvaluationContext,
  HeuristicJobContext,
  HeuristicLearningPlanContext,
  HeuristicPlanContext,
  HeuristicQuestionContext,
  HeuristicResumeContext,
} from '@/lib/ai/heuristic/context';

/**
 * Offline interview engine.
 *
 * This is not a stub and not a mock of an LLM: it is a deterministic analyzer
 * that scores answers from measurable properties of the text — specificity,
 * technical density, explicit reasoning, hedging, STAR completeness — and drives
 * the same adaptive state machine the LLM path drives.
 *
 * What it cannot do is verify that a claim is *true*. It measures the shape of
 * an answer, not its truth. Every report it produces is labelled with this
 * provider, and the UI states plainly that the platform is running without a
 * language model configured.
 *
 * It exists so the product runs end to end in development and CI without an
 * API key, and so a provider outage degrades the interview rather than ending it.
 */
export class HeuristicProvider implements AIProvider {
  readonly name = 'heuristic';
  readonly isLlm = false;

  modelFor(_tier: ModelTier): string {
    return 'offline-heuristic-v1';
  }

  async generateStructured<T extends z.ZodType>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>> {
    const started = Date.now();
    const produced = this.dispatch(request);

    // The offline engine validates its own output against the same contract the
    // LLM path uses, so a bug here fails loudly instead of writing a bad row.
    const result = request.schema.safeParse(produced);
    if (!result.success) {
      throw new AiError(
        'invalid_output',
        `Offline engine produced output that failed its own contract for ${request.task}.`,
        { provider: this.name, retryable: false },
      );
    }

    return {
      data: result.data,
      meta: {
        provider: this.name,
        model: this.modelFor(request.tier),
        // No tokens are spent, so the cost ledger correctly records zero.
        usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 },
        costUsd: 0,
        latencyMs: Date.now() - started,
      },
    };
  }

  private dispatch(request: StructuredRequest<z.ZodType>): unknown {
    const context = request.context;
    if (context === undefined) {
      throw new AiError(
        'provider_error',
        `The offline engine requires structured context for ${request.task}.`,
        { provider: this.name, retryable: false },
      );
    }

    switch (request.task) {
      case 'resume_analysis':
        return analyzeResumeOffline((context as HeuristicResumeContext).rawText);
      case 'job_analysis': {
        const ctx = context as HeuristicJobContext;
        return analyzeJobOffline(ctx.description, ctx.titleHint);
      }
      case 'interview_plan':
        return buildPlanOffline(context as HeuristicPlanContext);
      case 'question_generation':
        return generateQuestionOffline(context as HeuristicQuestionContext);
      case 'answer_analysis':
      case 'followup_decision':
        return analyzeAnswerOffline(context as HeuristicAnswerContext);
      case 'final_evaluation':
        return buildReportOffline(context as HeuristicEvaluationContext);
      case 'learning_plan':
        return buildLearningPlanOffline(context as HeuristicLearningPlanContext);
      default:
        throw new AiError('provider_error', `Unsupported offline task: ${request.task}`, {
          provider: this.name,
          retryable: false,
        });
    }
  }
}
