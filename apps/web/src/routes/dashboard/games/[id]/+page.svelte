<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import ChoiceShape from "$lib/ChoiceShape.svelte";
  import { api } from "$lib/api";
  import { GameResults } from "@quorum/protocol";

  const ATTEMPTS = 5;
  const gameId = page.params.id ?? "";

  // Le worker enregistre les résultats juste après la fin de la partie : on lui laisse quelques secondes.
  async function load(): Promise<GameResults> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await api(GameResults, `/games/${gameId}/results`);
      } catch (error) {
        if (attempt === ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  const results = load();
  const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
  const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`);
  const share = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100));
</script>

<a class="back" href={resolve("/dashboard/games")}>Toutes mes parties</a>

{#await results}
  <p>Chargement des résultats…</p>
{:then game}
  {@const teams = game.mode === "teams"}
  <h1>{game.title}</h1>
  <p class="meta">{date(game.endedAt)} · {teams ? "en équipes" : "en solo"}</p>

  <section>
    <h2>Classement</h2>
    <table>
      <thead>
        <tr>
          <th scope="col">Rang</th>
          <th scope="col">{teams ? "Équipe" : "Joueur"}</th>
          {#if teams}<th scope="col">Membres</th>{/if}
          <th scope="col">Score</th>
          <th scope="col">Bonnes réponses</th>
          <th scope="col">Temps moyen</th>
        </tr>
      </thead>
      <tbody>
        {#each game.teams as team (team.name)}
          <tr>
            <td>{team.rank}</td>
            <th scope="row">{team.name}</th>
            {#if teams}<td>{team.members.join(", ")}</td>{/if}
            <td>{team.score}</td>
            <td>{team.correctCount} / {game.questions.length}</td>
            <td>{seconds(team.averageResponseMs)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Questions</h2>
    {#each game.questions as question, number (question.id)}
      {@const answered = question.distribution.reduce((total, count) => total + count, 0)}
      {@const correct = question.distribution[question.correctIndex] ?? 0}
      <article>
        <h3>{number + 1}. {question.text}</h3>
        <p class="meta">
          Bonnes réponses : {correct} / {answered} ({share(correct, answered)} %) · temps moyen {seconds(question.averageResponseMs)}
        </p>
        <!-- Formes et couleurs : celles de l'écran projeté, dans l'ordre où les choix y étaient. -->
        <ul class="choices">
          {#each question.choices as choice, index (index)}
            {@const count = question.distribution[index] ?? 0}
            <li class={{ correct: index === question.correctIndex }}>
              <ChoiceShape {index} />
              <span>{choice}{#if index === question.correctIndex}&nbsp;<strong>(bonne réponse)</strong>{/if}</span>
              <span class="track"><span style:width="{share(count, answered)}%"></span></span>
              <span class="count">{count}</span>
            </li>
          {/each}
        </ul>
      </article>
    {/each}
  </section>
{:catch}
  <p class="error">Les résultats de cette partie ne sont pas disponibles.</p>
{/await}

<style>
  .back {
    font-weight: 600;
    color: var(--brand);
  }

  .meta {
    color: var(--ink-muted);
  }

  section {
    margin-top: 2rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  th,
  td {
    border-bottom: 1px solid var(--line);
    padding: 0.6rem 0.8rem;
    text-align: left;
  }

  tbody th {
    font-weight: 600;
  }

  article {
    margin-bottom: 1rem;
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h3 {
    margin: 0;
  }

  .choices {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .choices li {
    display: grid;
    grid-template-columns: auto 1fr minmax(4rem, 10rem) 2rem;
    align-items: center;
    gap: 0.75rem;
  }

  .track {
    height: 0.6rem;
    border-radius: 999px;
    overflow: hidden;
    background: var(--line);
  }

  .track span {
    display: block;
    height: 100%;
    background: var(--brand);
  }

  .correct .track span {
    background: var(--success);
  }

  .count {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
</style>
