<script lang="ts">
  import { page } from "$app/state";
  import ChoiceShape from "$lib/ChoiceShape.svelte";
  import Countdown from "$lib/Countdown.svelte";
  import Standings from "$lib/Standings.svelte";
  import { GameConnection } from "$lib/game.svelte";
  import { errorMessage } from "$lib/messages";
  import type { ErrorCode } from "@quorum/protocol";
  import { onDestroy } from "svelte";

  // Le jeton survit au rechargement de la page : le joueur reprend la partie là où il en était.
  const TOKEN_KEY = "quorum:token";

  let pin = $state(page.url.searchParams.get("pin") ?? "");
  let nickname = $state("");
  let game: GameConnection | null = $state(null);

  const savedToken = sessionStorage.getItem(TOKEN_KEY);
  if (savedToken) game = new GameConnection({ token: savedToken, onError: forgetSession });
  onDestroy(() => game?.close());

  const view = $derived(game?.view?.role === "player" ? game.view : null);

  function forgetSession(code: ErrorCode) {
    if (code === "invalid_token" || code === "game_not_found" || code === "kicked") sessionStorage.removeItem(TOKEN_KEY);
  }

  function join(event: SubmitEvent) {
    event.preventDefault();
    game?.close();
    game = new GameConnection({
      onOpen: (connection) => {
        connection.send({ type: "join", pin, nickname });
      },
      onWelcome: (token) => {
        sessionStorage.setItem(TOKEN_KEY, token);
      },
      onError: forgetSession,
    });
  }

  function answer(choiceIndex: number) {
    const stage = game?.view?.stage;
    if (stage?.phase === "question") game?.send({ type: "answer", questionId: stage.question.questionId, choiceIndex });
  }

  const ordinal = (rank: number) => (rank === 1 ? "1er" : `${String(rank)}e`);
</script>

<main>
  {#if game?.status === "kicked"}
    <p class="screen">{errorMessage("kicked")}</p>
  {:else if view}
    {@const stage = view.stage}
    {#if game?.status === "reconnecting"}<p class="banner" role="status">Connexion perdue, reconnexion…</p>{/if}
    <header>
      <strong>{view.nickname}</strong>
      {#if stage.phase === "question"}<Countdown deadline={stage.question.deadline} offset={game?.clockOffset ?? 0} />{/if}
    </header>

    {#if stage.phase === "lobby"}
      <p class="screen">C'est bon, tu es dans la partie ! Regarde l'écran : ça va commencer.</p>
    {:else if stage.phase === "question"}
      {#if stage.answered}
        <p class="screen">Réponse envoyée ! Attends les autres…</p>
      {:else}
        <p class="text">{stage.question.text}</p>
        <div class="answers">
          {#each stage.question.choices as choice, index (index)}
            <button
              style:--color="var(--choice-{index})"
              disabled={game?.status !== "open"}
              onclick={() => {
                answer(index);
              }}
            >
              <ChoiceShape {index} size="2.5rem" />
              <span>{choice}</span>
            </button>
          {/each}
        </div>
      {/if}
    {:else if stage.phase === "reveal"}
      {#if stage.you && stage.you.points > 0}
        <p class="screen good">Bonne réponse !<br /><strong>+{stage.you.points}</strong></p>
      {:else}
        <p class="screen bad">Raté…</p>
      {/if}
      <p class="score">Score : {stage.you?.score ?? 0}</p>
    {:else if stage.phase === "leaderboard"}
      <p class="screen">
        {#if stage.you}Tu es <strong>{ordinal(stage.you.rank)}</strong> avec {stage.you.score} points{:else}Regarde le classement à l'écran{/if}
      </p>
    {:else}
      <h1>Podium</h1>
      <Standings standings={stage.podium} highlight={view.nickname} />
      <p class="score">Merci d'avoir joué !</p>
    {/if}

    {#if game?.error}<p class="error" role="alert">{errorMessage(game.error)}</p>{/if}
  {:else if game?.status === "closed"}
    <p class="screen">Connexion perdue. <button
        onclick={() => {
          location.reload();
        }}>Recharger</button
      ></p>
  {:else if game && !game.error}
    <p class="screen">Connexion…</p>
  {:else}
    <form onsubmit={join}>
      <h1>Rejoindre une partie</h1>
      <label>
        Code de la partie
        <input bind:value={pin} inputmode="numeric" pattern={"\\d{6}"} maxlength="6" required autocomplete="off" />
      </label>
      <label>Pseudo <input bind:value={nickname} maxlength="20" required autocomplete="nickname" /></label>
      {#if game?.error}<p class="error" role="alert">{errorMessage(game.error)}</p>{/if}
      <button class="primary">Rejoindre</button>
    </form>
  {/if}
</main>

<style>
  main {
    display: grid;
    align-content: start;
    gap: 1.25rem;
    max-width: 32rem;
    min-height: 100dvh;
    margin: 0 auto;
    padding: 1.25rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 3rem;
  }

  .screen {
    margin: 20vh 0 0;
    font-size: 1.5rem;
    font-weight: 700;
    text-align: center;
  }

  .good {
    color: var(--success);
  }

  .good strong {
    font-size: 2.5rem;
  }

  .bad {
    color: var(--danger);
  }

  .score {
    text-align: center;
    color: var(--ink-muted);
  }

  .text {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 700;
  }

  .answers {
    display: grid;
    gap: 0.75rem;
  }

  .answers button {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-height: 5rem;
    border: none;
    border-left: 0.6rem solid var(--color);
    padding: 1rem;
    font-size: 1.15rem;
    text-align: left;
    box-shadow: var(--shadow);
  }

  .answers button:active {
    transform: scale(0.98);
  }

  form {
    display: grid;
    gap: 1rem;
    margin-top: 10vh;
  }

  form h1 {
    margin: 0;
    color: var(--brand);
  }

  form input {
    font-size: 1.3rem;
  }

  form button {
    padding-block: 0.9rem;
    font-size: 1.15rem;
  }

  .error {
    text-align: center;
  }

  .banner {
    position: fixed;
    inset: 0 0 auto;
    margin: 0;
    padding: 0.5rem;
    text-align: center;
    background: var(--accent);
  }
</style>
