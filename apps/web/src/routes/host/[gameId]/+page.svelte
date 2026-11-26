<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { env } from "$env/dynamic/public";
  import ChoiceShape from "$lib/ChoiceShape.svelte";
  import Countdown from "$lib/Countdown.svelte";
  import Standings from "$lib/Standings.svelte";
  import { api } from "$lib/api";
  import { GameConnection } from "$lib/game.svelte";
  import { errorMessage } from "$lib/messages";
  import { type ClientMessage, HostToken, type PlayerId } from "@quorum/protocol";
  import { toString as qrSvg } from "qrcode";
  import { onDestroy } from "svelte";

  const gameId = page.params.gameId ?? "";
  let game = $state<GameConnection | null>(null);
  let failed = $state(false);

  const fetchToken = async () => (await api(HostToken, `/games/${gameId}/host-token`, { method: "POST" })).token;
  fetchToken()
    .then((token) => {
      game = new GameConnection({ token, refreshToken: fetchToken });
    })
    .catch(() => {
      failed = true;
    });
  onDestroy(() => game?.close());

  const view = $derived(game?.view?.role === "host" ? game.view : null);
  const joinUrl = $derived(view ? new URL(`/play?pin=${view.pin}`, env["PUBLIC_ORIGIN"] ?? location.origin) : null);
  const qrCode = $derived(joinUrl ? qrSvg(joinUrl.href, { type: "svg", margin: 1 }) : null);

  function send(message: ClientMessage) {
    game?.send(message);
  }

  function kick(playerId: PlayerId) {
    send({ type: "kick", playerId });
  }

  const plural = (count: number, word: string) => `${String(count)} ${word}${count > 1 ? "s" : ""}`;

  function end() {
    if (confirm("Terminer la partie maintenant ?")) send({ type: "end" });
  }
</script>

<main>
  {#if failed}
    <p class="notice">Cette partie n'existe plus. <a href={resolve("/dashboard")}>Retour à mes quiz</a></p>
  {:else if game?.status === "closed"}
    <p class="notice">Connexion perdue. <button
        onclick={() => {
          location.reload();
        }}>Recharger</button
      ></p>
  {:else if !view}
    <p class="notice">Connexion…</p>
  {:else}
    {@const stage = view.stage}
    {#if game?.status === "reconnecting"}<p class="banner" role="status">Connexion perdue, reconnexion…</p>{/if}
    {#if stage.phase === "lobby"}
      <section class="lobby">
        <div class="join">
          <p>Rejoignez sur <strong>{joinUrl?.host}/play</strong> avec le code</p>
          <p class="pin">{view.pin}</p>
          {#await qrCode then svg}
            {#if svg}
              <img src="data:image/svg+xml;utf8,{encodeURIComponent(svg)}" alt="QR code pour rejoindre la partie" />
            {/if}
          {/await}
        </div>
        <div class="players">
          {#snippet chip(player: { playerId: PlayerId; nickname: string }, captain = false)}
            <li>
              {player.nickname}{#if captain}&nbsp;(capitaine){/if}
              <button
                class="kick"
                aria-label="Exclure {player.nickname}"
                onclick={() => {
                  kick(player.playerId);
                }}>✕</button
              >
            </li>
          {/snippet}
          {#if view.mode === "teams"}
            <h2>{plural(view.teams.length, "équipe")} · {plural(view.players.length, "joueur")}</h2>
            {#each view.teams as team (team.teamId)}
              <section class="team" aria-label={team.name}>
                <h3>{team.name}</h3>
                <ul>
                  <!-- Le premier membre arrivé est le capitaine. -->
                  {#each view.players.filter(({ teamId }) => teamId === team.teamId) as player, index (player.playerId)}
                    {@render chip(player, index === 0)}
                  {/each}
                </ul>
              </section>
            {/each}
          {:else}
            <h2>{plural(view.players.length, "joueur")}</h2>
            <ul>
              {#each view.players as player (player.playerId)}
                {@render chip(player)}
              {/each}
            </ul>
          {/if}
          <button
            class="primary big"
            disabled={view.players.length === 0 || game?.status !== "open"}
            onclick={() => {
              send({ type: "start" });
            }}>Lancer la partie</button
          >
        </div>
      </section>
    {:else if stage.phase === "question" || stage.phase === "reveal"}
      <!-- Les deux tiers du haut : l'énoncé, posé sur l'image de la question. Le tiers du bas : les réponses, en 2 × 2. -->
      <section class="question">
        <div class="stage">
          {#if stage.question.imageUrl}<img src={stage.question.imageUrl} alt="Illustration de la question" />{/if}
          <header>
            <h1>{stage.question.text}</h1>
            {#if stage.phase === "question"}<Countdown deadline={stage.question.deadline} offset={game?.clockOffset ?? 0} />{/if}
          </header>
          <footer>
            {#if stage.phase === "question"}
              <p>{stage.answerCount ?? 0} / {view.teams.length} {view.mode === "teams" ? "équipes ont répondu" : "réponses"}</p>
              <button
                disabled={game?.status !== "open"}
                onclick={() => {
                  send({ type: "next" });
                }}>Arrêter la question</button
              >
            {:else}
              <button
                class="primary big"
                disabled={game?.status !== "open"}
                onclick={() => {
                  send({ type: "next" });
                }}>Classement</button
              >
            {/if}
          </footer>
        </div>
        <ul class="choices">
          {#each stage.question.choices as choice, index (index)}
            <li
              style:--color="var(--choice-{index})"
              class={{
                correct: stage.phase === "reveal" && index === stage.correctIndex,
                faded: stage.phase === "reveal" && index !== stage.correctIndex,
              }}
            >
              <ChoiceShape {index} size="2.5rem" />
              <span>{choice}</span>
              {#if stage.phase === "reveal"}<strong class="votes">{stage.distribution[index] ?? 0}</strong>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {:else if stage.phase === "leaderboard"}
      <section class="ranking">
        <h1>Classement</h1>
        <Standings standings={stage.top} />
        <button
          class="primary big"
          disabled={game?.status !== "open"}
          onclick={() => {
            send({ type: "next" });
          }}>Suivant</button
        >
      </section>
    {:else}
      <section class="ranking">
        <h1>Podium</h1>
        <Standings standings={stage.podium} />
        <a href={resolve("/dashboard")}>Retour à mes quiz</a>
      </section>
    {/if}

    {#if game?.error}<p class="error" role="alert">{errorMessage(game.error)}</p>{/if}
    {#if stage.phase !== "ended"}<button class="end" onclick={end}>Terminer la partie</button>{/if}
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2rem;
    min-height: 100dvh;
    padding: clamp(1rem, 4vw, 3rem);
    background: var(--brand);
    color: var(--brand-ink);
    font-size: clamp(1rem, 1.6vw, 1.4rem);
  }

  .notice {
    text-align: center;
  }

  .notice a {
    color: var(--accent);
  }

  .lobby {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 3rem;
    align-items: start;
  }

  .join {
    display: grid;
    justify-items: center;
    gap: 1rem;
    text-align: center;
  }

  .join p {
    margin: 0;
  }

  .pin {
    font-size: clamp(3rem, 9vw, 7rem);
    font-weight: 800;
    letter-spacing: 0.15em;
    color: var(--accent);
  }

  .join img {
    width: min(18rem, 60vw);
    border-radius: var(--radius);
    background: #fff;
  }

  .players ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0 0 1.5rem;
    padding: 0;
    list-style: none;
  }

  .team h3 {
    margin: 0 0 0.5rem;
  }

  .players li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: 999px;
    padding: 0.3rem 0.4rem 0.3rem 1rem;
    background: rgb(255 255 255 / 15%);
  }

  .kick {
    border: none;
    border-radius: 50%;
    padding: 0.2rem 0.5rem;
    background: transparent;
    color: inherit;
  }

  .big {
    padding: 1rem 2.5rem;
    font-size: 1.2em;
  }

  main .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--ink);
  }

  /* La question occupe tout l'écran : 2/3 pour l'énoncé et l'image, 1/3 pour les réponses. */
  .question {
    display: grid;
    flex: 1;
    grid-template-rows: 2fr 1fr;
    gap: 1rem;
  }

  .stage {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 1rem;
    overflow: hidden;
    border-radius: var(--radius);
  }

  /* L'image entière, sans recadrage, derrière l'énoncé. */
  .stage img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .stage header,
  .stage footer {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
  }

  .stage header {
    border-radius: var(--radius);
    padding: 1rem 1.5rem;
    background: rgb(0 0 0 / 55%);
  }

  .stage h1 {
    margin: 0;
    font-size: clamp(1.8rem, 3.5vw, 3rem);
  }

  .stage footer button {
    margin-left: auto;
    color: var(--ink);
  }

  .stage footer p {
    margin: 0;
    border-radius: var(--radius);
    padding: 0.5rem 1rem;
    background: rgb(0 0 0 / 55%);
  }

  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: 1fr;
    gap: 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .choices li {
    display: flex;
    align-items: center;
    gap: 1rem;
    overflow: hidden;
    border-left: 0.6rem solid var(--color);
    border-radius: var(--radius);
    padding: 1rem 1.5rem;
    font-size: clamp(1rem, 2.2vw, 1.8rem);
    font-weight: 700;
    background: var(--surface);
    color: var(--ink);
    transition: opacity 0.3s;
  }

  .choices li.correct {
    outline: 4px solid var(--accent);
  }

  .choices li.faded {
    opacity: 0.45;
  }

  .votes {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .ranking {
    display: grid;
    gap: 1.5rem;
    width: min(40rem, 100%);
    margin: 0 auto;
    font-size: 1.2em;
  }

  .ranking h1 {
    margin: 0;
    text-align: center;
  }

  .ranking a {
    justify-self: center;
    color: var(--accent);
  }

  .error {
    color: var(--accent);
    text-align: center;
  }

  .banner {
    position: fixed;
    inset: 0 0 auto;
    margin: 0;
    padding: 0.5rem;
    text-align: center;
    background: var(--accent);
    color: var(--ink);
  }

  .end {
    align-self: flex-end;
    border-color: transparent;
    background: transparent;
    color: inherit;
    opacity: 0.7;
  }
</style>
