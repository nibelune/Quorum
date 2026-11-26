<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { api } from "$lib/api";
  import { CreatedGame, type GameMode, QuizSummary } from "@quorum/protocol";
  import { z } from "zod";

  const loadQuizzes = () => api(z.array(QuizSummary), "/quizzes");
  let quizzes = $state(loadQuizzes());

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
  <a class="new" href={resolve("/dashboard/quizzes/[id]", { id: "new" })}>Nouveau quiz</a>
</div>

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
    align-items: center;
    gap: 0.75rem;
  }

  .actions a {
    font-weight: 600;
    color: var(--brand);
  }

  .empty {
    color: var(--ink-muted);
  }
</style>
