<script lang="ts">
  import { resolve } from "$app/paths";
  import { api } from "$lib/api";
  import { GameSummary } from "@quorum/protocol";
  import { z } from "zod";

  const games = api(z.array(GameSummary), "/games");
  const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
</script>

<h1>Mes parties</h1>

{#await games}
  <p>Chargement…</p>
{:then list}
  {#if list.length === 0}
    <p class="empty">Aucune partie terminée pour l'instant.</p>
  {:else}
    <ul>
      {#each list as game (game.id)}
        <li>
          <a href={resolve("/dashboard/games/[id]", { id: game.id })}>
            <strong>{game.title}</strong>
            <span>
              {date(game.endedAt)} · {game.mode === "teams" ? "en équipes" : "en solo"} · {game.playerCount} joueur{game.playerCount > 1
                ? "s"
                : ""}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
{:catch}
  <p class="error">Impossible de charger vos parties.</p>
{/await}

<style>
  ul {
    display: grid;
    gap: 1rem;
    padding: 0;
    list-style: none;
  }

  a {
    display: grid;
    gap: 0.3rem;
    border-radius: var(--radius);
    padding: 1.25rem;
    background: var(--surface);
    color: inherit;
    text-decoration: none;
    box-shadow: var(--shadow);
  }

  a:hover strong {
    text-decoration: underline;
  }

  span,
  .empty {
    color: var(--ink-muted);
  }
</style>
