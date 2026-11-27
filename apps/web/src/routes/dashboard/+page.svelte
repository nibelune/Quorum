<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { api } from "$lib/api";
  import { CreatedGame, type GameMode, Quiz, QuizInput, QuizSummary } from "@quorum/protocol";
  import { z } from "zod";

  const loadQuizzes = () => api(z.array(QuizSummary), "/quizzes");
  let quizzes = $state(loadQuizzes());
  let error = $state("");

  // Un quiz sans les identifiants de ses questions : c'est le format d'export, et une copie que le serveur numérote à nouveau,
  // pour que ses statistiques restent séparées de celles de l'original.
  const withoutIds = ({ title, questions }: Quiz): QuizInput => ({
    title,
    questions: questions.map((question) => ({ ...question, id: undefined })),
  });

  async function duplicate(summary: QuizSummary) {
    const quiz = withoutIds(await api(Quiz, `/quizzes/${summary.id}`));
    // Le titre reste dans la limite de 120 caractères.
    await api(Quiz, "/quizzes", { method: "POST", body: { ...quiz, title: `${quiz.title} (copie)`.slice(0, 120) } });
    quizzes = loadQuizzes();
  }

  async function exportQuiz(summary: QuizSummary) {
    const quiz = withoutIds(await api(Quiz, `/quizzes/${summary.id}`));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(quiz, null, 2)], { type: "application/json" }));
    link.download = `${quiz.title}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // Le fichier est validé comme une création de quiz : le format d'export est le corps de `POST /api/quizzes`.
  // Ses images restent celles de cette instance de Quorum.
  async function importQuiz(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const quiz = QuizInput.safeParse(await file.text().then(JSON.parse).catch(() => null));
    error = quiz.success ? "" : "Ce fichier n'est pas un quiz exporté de Quorum.";
    if (!quiz.success) return;
    await api(Quiz, "/quizzes", { method: "POST", body: quiz.data });
    quizzes = loadQuizzes();
  }

  async function remove(quiz: QuizSummary) {
    if (!confirm(`Supprimer « ${quiz.title} » ?`)) return;
    await api(z.null(), `/quizzes/${quiz.id}`, { method: "DELETE" });
    quizzes = loadQuizzes();
  }

  async function launch(quiz: QuizSummary, mode: GameMode) {
    const { gameId } = await api(CreatedGame, "/games", { method: "POST", body: { quizId: quiz.id, mode } });
    await goto(resolve("/host/[gameId]", { gameId }));
  }
</script>

<div class="title">
  <h1>Mes quiz</h1>
  <div class="actions">
    <label class="import">
      Importer un quiz
      <input
        type="file"
        accept="application/json,.json"
        onchange={(event) => {
          void importQuiz(event.currentTarget);
        }}
      />
    </label>
    <a class="new" href={resolve("/dashboard/quizzes/[id]", { id: "new" })}>Nouveau quiz</a>
  </div>
</div>
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#await quizzes}
  <p>Chargement…</p>
{:then list}
  {#if list.length === 0}
    <p class="empty">Aucun quiz pour l'instant. Créez le premier !</p>
  {:else}
    <ul>
      {#each list as quiz (quiz.id)}
        <li>
          <div>
            <h2>{quiz.title}</h2>
            <p>
              {quiz.questionCount} question{quiz.questionCount > 1 ? "s" : ""} · modifié le
              {new Date(quiz.updatedAt).toLocaleDateString("fr-FR")}
            </p>
          </div>
          <div class="actions">
            <button class="primary" onclick={() => launch(quiz, "solo")}>Lancer</button>
            <button onclick={() => launch(quiz, "teams")}>Lancer en équipes</button>
            <a href={resolve("/dashboard/quizzes/[id]", { id: quiz.id })}>Modifier</a>
            <button onclick={() => duplicate(quiz)}>Dupliquer</button>
            <button onclick={() => exportQuiz(quiz)}>Exporter</button>
            <button class="danger" onclick={() => remove(quiz)}>Supprimer</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
{:catch}
  <p class="error">Impossible de charger vos quiz.</p>
{/await}

<style>
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  a.new {
    border-radius: var(--radius);
    padding: 0.6rem 1.1rem;
    font-weight: 600;
    background: var(--brand);
    color: var(--brand-ink);
    text-decoration: none;
  }

  ul {
    display: grid;
    gap: 1rem;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: 1.2rem;
  }

  li p {
    margin: 0.25rem 0 0;
    color: var(--ink-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  /* Le champ fichier reste accessible au clavier, sous l'apparence d'un bouton. */
  .import {
    position: relative;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.6rem 1.1rem;
    font-weight: 600;
    background: var(--surface);
    cursor: pointer;
  }

  .import:focus-within {
    outline: 2px solid var(--brand);
  }

  .import input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .actions a {
    font-weight: 600;
    color: var(--brand);
  }

  .empty {
    color: var(--ink-muted);
  }
</style>
