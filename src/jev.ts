import { experimental_evaluate as evaluate } from 'ai';
import type { GameState } from './types.js';

const MODEL = 'typesafe-ai/jev';

export type Choice = {
  /** Executable action id (`click_cookie`, `buy_building_0`, …). */
  action: string;
  /** Numbered key Jev returned (`"1"`, `"2"`, …). */
  key: string;
  description: string;
  probabilities?: Record<string, number>;
  usage?: { inputTokens?: number; outputTokens?: number };
};

/**
 * Ask Jev, via Vercel AI Gateway only, which numbered candidate to run.
 *
 * AI SDK 7 `experimental_evaluate` names the option map `criteria`
 * (a record of option key → description). The model returns `choice`
 * plus probabilities. It does not see the screen and does not emit code.
 */
export async function chooseAction(state: GameState): Promise<Choice> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AI_GATEWAY_API_KEY is missing. Copy .env.example to .env and set your Vercel AI Gateway key.',
    );
  }
  if (state.candidates.length === 0) {
    throw new Error('No action candidates to choose from.');
  }

  const criteria: Record<string, string> = {};
  for (const candidate of state.candidates) {
    criteria[candidate.key] = candidate.description;
  }

  const result = await evaluate({
    model: MODEL,
    state: {
      cookies: round(state.cookies, 1),
      cps: round(state.cps, 2),
      summary: state.summary,
      goal: 'Raise cookies and cookies per second. Click or wait when a building or upgrade is not affordable yet. Buy when one is. Stop only when continuing cannot help.',
    },
    questions: {
      action: {
        type: 'choice',
        instructions: '次に取るべき一手',
        criteria,
      },
    },
  });

  const answer = result.answers.action;
  if (!answer || answer.type !== 'choice' || typeof answer.choice !== 'string') {
    throw new Error(`Unexpected Jev answer shape: ${JSON.stringify(answer)}`);
  }

  const chosen = state.candidates.find((candidate) => candidate.key === answer.choice);
  if (!chosen) {
    const known = state.candidates.map((candidate) => candidate.key).join(', ');
    throw new Error(`Jev returned unknown choice "${answer.choice}". Known keys: ${known}`);
  }

  return {
    action: chosen.id,
    key: chosen.key,
    description: chosen.description,
    probabilities: answer.probabilities,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
  };
}

function round(n: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}
