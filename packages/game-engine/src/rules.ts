import type { Question, ShownQuestion, Standing } from "@quorum/protocol";
import type { Answer, GameState, Player } from "./state.ts";

export const GRACE_MS = 250;
const TOP_SIZE = 10;
const PODIUM_SIZE = 5;

export function questionAt(state: GameState, index: number): Question {
  const question = state.questions[index];
  if (!question) throw new Error(`La partie n'a pas de question ${String(index)}`);
  return question;
}

export function deadlineOf(question: Question, startedAt: number): number {
  return startedAt + question.durationSec * 1000;
}

export function shownQuestion(question: Question, startedAt: number): ShownQuestion {
  return {
    questionId: question.id,
    text: question.text,
    choices: question.choices,
    deadline: deadlineOf(question, startedAt),
  };
}

export function pointsFor(question: Question, startedAt: number, answer: Answer | undefined): number {
  if (answer?.choiceIndex !== question.correctIndex) return 0;
  const duration = question.durationSec * 1000;
  // Bornée des deux côtés : la tolérance réseau ne coûte pas de points, et un léger décalage d'horloge entre nœuds n'en donne pas.
  const responseTime = Math.min(Math.max(answer.at - startedAt, 0), duration);
  return Math.round(1000 * (1 - responseTime / duration / 2));
}

export function distribution(question: Question, answers: Answer[]): number[] {
  return question.choices.map((_, index) => answers.filter((answer) => answer.choiceIndex === index).length);
}

// Le tri est stable : à score égal, le joueur arrivé le plus tôt passe devant.
function standings(players: Player[], size: number): Standing[] {
  return players
    .toSorted((a, b) => b.score - a.score)
    .slice(0, size)
    .map(({ nickname, score }) => ({ nickname, score }));
}

export function top(players: Player[]): Standing[] {
  return standings(players, TOP_SIZE);
}

export function podium(players: Player[]): Standing[] {
  return standings(players, PODIUM_SIZE);
}

export function rankOf(players: Player[], player: Player): number {
  return 1 + players.filter((other) => other.score > player.score).length;
}
