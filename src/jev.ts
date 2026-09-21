import { experimental_evaluate as evaluate } from 'ai';
import type { GameState } from './types.js';

const MODEL = 'typesafe-ai/jev';

/**
 * Ask Jev (via Vercel AI Gateway only) which action to take next.
 * Uses AI SDK experimental_evaluate with a choice question.
 * Criteria shape: Record<optionKey, description> (not "options").
 */
export async function chooseAction(state: GameState): Promise<{
  action: string;
  probabilities?: Record<string, number>;
}> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AI_GATEWAY_API_KEY is missing. Copy .env.example to .env and set your Vercel AI Gateway key.',
    );
  }

  const keys = Object.keys(state.candidates);
  if (keys.length === 0) {
    throw new Error('No action candidates to choose from.');
  }

  // String IDs route through AI Gateway; AI_GATEWAY_API_KEY authenticates.
  const result = await evaluate({
    model: MODEL,
    state: {
      cookies: state.cookies,
      cps: state.cps,
      summary: state.summary,
      affordable: state.candidates,
    },
    questions: {
      action: {
        type: 'choice',
        instructions:
          '次に取るべき一手を選んでください。クッキーを増やし、長期的なCPS成長を優先してください。',
        criteria: state.candidates,
      },
    },
  });

  const answer = result.answers.action;
  if (!answer || answer.type !== 'choice' || typeof answer.choice !== 'string') {
    throw new Error(`Unexpected Jev answer shape: ${JSON.stringify(answer)}`);
  }

  const action = answer.choice;
  if (!(action in state.candidates)) {
    throw new Error(
      `Jev returned unknown action "${action}". Known: ${keys.join(', ')}`,
    );
  }

  return {
    action,
    probabilities: answer.probabilities as Record<string, number> | undefined,
  };
}
