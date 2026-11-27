import type { Question, ShownQuestion, Standing, TeamId } from "@quorum/protocol";
import type { Answer, GameState, Player, Team } from "./state.ts";

export const GRACE_MS = 250;
const TOP_SIZE = 10;
const PODIUM_SIZE = 5;

export function questionAt(state: GameState, index: number): Question {
  const question = state.questions[index];
  if (!question) throw new Error(`La partie n'a pas de question ${String(index)}`);
  return question;
}

// L'aléa est fourni par l'appelant, comme l'heure : le moteur reste déterministe. `() => 0` garde l'ordre d'origine.
export function shuffleChoices(question: Question, random: () => number): Question {
  const remaining = question.choices.map((text, index) => ({ text, index }));
  const shuffled: typeof remaining = [];
  while (remaining.length > 0) shuffled.push(...remaining.splice(Math.floor(random() * remaining.length), 1));
  const choices = shuffled.map(({ text }) => text);
  const positionOf = (original: number) => shuffled.findIndex(({ index }) => index === original);
  switch (question.kind) {
    case "choice":
      return { ...question, choices, correctIndex: positionOf(question.correctIndex) };
    case "order":
      return { ...question, choices, correctOrder: question.correctOrder.map(positionOf) };
    case "poll":
      return { ...question, choices };
  }
}

// Un sondage n'a pas de bonne réponse.
export function correctIndexOf(question: Question): number | undefined {
  return question.kind === "choice" ? question.correctIndex : undefined;
}

export function correctOrderOf(question: Question): number[] | undefined {
  return question.kind === "order" ? question.correctOrder : undefined;
}

function isCorrect(question: Question, answer: Answer): boolean {
  switch (question.kind) {
    case "choice":
      return answer.choiceIndex === question.correctIndex;
    // Tout ou rien : chaque élément doit être à sa place (ADR 0015).
    case "order":
      return answer.order?.join() === question.correctOrder.join();
    // Un sondage ne rapporte aucun point.
    case "poll":
      return false;
  }
}

export function deadlineOf(question: Question, startedAt: number): number {
  return startedAt + question.durationSec * 1000;
}

export function shownQuestion(question: Question, startedAt: number): ShownQuestion {
  return {
    questionId: question.id,
    kind: question.kind,
    text: question.text,
    choices: question.choices,
    ...(question.imageUrl !== undefined && { imageUrl: question.imageUrl }),
    deadline: deadlineOf(question, startedAt),
  };
}

export function pointsFor(question: Question, startedAt: number, answer: Answer | undefined): number {
  if (!answer || !isCorrect(question, answer)) return 0;
  const duration = question.durationSec * 1000;
  // Bornée des deux côtés : la tolérance réseau ne coûte pas de points, et un léger décalage d'horloge entre nœuds n'en donne pas.
  const responseTime = Math.min(Math.max(answer.at - startedAt, 0), duration);
  return Math.round(1000 * (1 - responseTime / duration / 2));
}

export function distribution(question: Question, answers: Answer[]): number[] {
  return question.choices.map((_, index) => answers.filter((answer) => answer.choiceIndex === index).length);
}

// Une équipe telle qu'elle est annoncée, sans son score.
export function teamRef({ teamId, name }: Team) {
  return { teamId, name };
}

// Le membre arrivé le plus tôt : le créateur de l'équipe, puis le plus ancien s'il est exclu.
export function captainOf(state: GameState, teamId: TeamId): Player | undefined {
  return state.players.find((player) => player.teamId === teamId);
}

// Le tri est stable : à score égal, l'équipe créée la plus tôt passe devant.
function standings(teams: Team[], size: number): Standing[] {
  return teams
    .toSorted((a, b) => b.score - a.score)
    .slice(0, size)
    .map(({ name, score }) => ({ name, score }));
}

export function top(teams: Team[]): Standing[] {
  return standings(teams, TOP_SIZE);
}

export function podium(teams: Team[]): Standing[] {
  return standings(teams, PODIUM_SIZE);
}

export function rankOf(teams: Team[], team: Team): number {
  return 1 + teams.filter((other) => other.score > team.score).length;
}
