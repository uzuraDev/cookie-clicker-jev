import { experimental_evaluate as evaluate } from 'ai';
import type { GameState } from './types.js';

const MODEL = 'typesafe-ai/jev';

export type JevChoice = {
  action: string;
  probabilities?: Record<string, number>;
};

/**
 * Choice question through Vercel AI Gateway only.
 * String model ids route to the gateway; `AI_GATEWAY_API_KEY` authenticates.
 * Never calls the TypeSafe direct API.
 */
async function evaluateChoice(input: {
  state: {
    cookies?: number;
    cps?: number;
    summary?: string;
    affordable?: Record<string, string>;
    bakedAllTime?: number;
    elapsed?: string;
    goal?: string;
  };
  instructions: string;
  criteria: Record<string, string>;
}): Promise<JevChoice> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AI_GATEWAY_API_KEY is missing. Copy .env.example to .env and set your Vercel AI Gateway key.',
    );
  }

  const keys = Object.keys(input.criteria);
  if (keys.length === 0) {
    throw new Error('No action candidates to choose from.');
  }

  const result = await evaluate({
    model: MODEL,
    state: input.state,
    questions: {
      action: {
        type: 'choice',
        instructions: input.instructions,
        criteria: input.criteria,
      },
    },
  });

  const answer = result.answers.action;
  if (!answer || answer.type !== 'choice' || typeof answer.choice !== 'string') {
    throw new Error(`Unexpected Jev answer shape: ${JSON.stringify(answer)}`);
  }

  const action = answer.choice;
  if (!(action in input.criteria)) {
    throw new Error(
      `Jev returned unknown action "${action}". Known: ${keys.join(', ')}`,
    );
  }

  return {
    action,
    probabilities: answer.probabilities as Record<string, number> | undefined,
  };
}

/**
 * Ask Jev which action to take next in the step loop.
 * Criteria shape: Record<optionKey, description> (not "options").
 */
export async function chooseAction(state: GameState): Promise<JevChoice> {
  return evaluateChoice({
    state: {
      cookies: state.cookies,
      cps: state.cps,
      summary: state.summary,
      affordable: state.candidates,
    },
    instructions:
      '次に取るべき一手を選んでください。クッキーを増やし、長期的なCPS成長を優先してください。',
    criteria: state.candidates,
  });
}

/**
 * Ask Jev to break a close ROI tie. Called only when several purchases
 * are similarly efficient — never once per click.
 */
export async function choosePurchase(input: {
  summary: string;
  cookies: number;
  cps: number;
  baked: number;
  elapsed: string;
  candidates: Record<string, string>;
}): Promise<JevChoice> {
  return evaluateChoice({
    state: {
      summary: input.summary,
      cookies: input.cookies,
      cps: input.cps,
      bakedAllTime: input.baked,
      elapsed: input.elapsed,
      goal: 'Ascend at 1e12 cookies baked (1 heavenly chip) as fast as possible',
    },
    instructions:
      'Choose the one purchase that most reduces time to the first heavenly chip (1e12 cookies baked, then ascend). Prefer shorter payback, higher click power, higher CpS, and golden-cookie frequency.',
    criteria: input.candidates,
  });
}
