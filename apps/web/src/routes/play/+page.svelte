<script lang="ts">
  import { page } from "$app/state";
  import ChoiceShape from "$lib/ChoiceShape.svelte";
  import Countdown from "$lib/Countdown.svelte";
  import Standings from "$lib/Standings.svelte";
  import { GameConnection } from "$lib/game.svelte";
  import { errorMessage } from "$lib/messages";
  import { playerChoices } from "$lib/order";
  import type { ErrorCode, TeamChoice } from "@quorum/protocol";
  import { onDestroy } from "svelte";

  // Le jeton survit au rechargement de la page : le joueur reprend la partie là où il en était.
  const TOKEN_KEY = "quorum:token";

  let pin = $state(page.url.searchParams.get("pin") ?? "");
  let nickname = $state("");
  let teamName = $state("");
  let game: GameConnection | null = $state(null);

  const savedToken = sessionStorage.getItem(TOKEN_KEY);
  if (savedToken) game = new GameConnection({ token: savedToken, onError: forgetSession });
  onDestroy(() => game?.close());

  const view = $derived(game?.view?.role === "player" ? game.view : null);
  // En mode équipes, le visiteur choisit son équipe avant de rejoindre. Un pseudo déjà pris le renvoie au formulaire.
  const visitor = $derived(
    game?.view?.role === "visitor" && game.view.mode === "teams" && game.error !== "nickname_taken" ? game.view : null,
  );

  function forgetSession(code: ErrorCode) {
    if (code === "invalid_token" || code === "game_not_found" || code === "kicked") sessionStorage.removeItem(TOKEN_KEY);
  }

  function lookup(event: SubmitEvent) {
    event.preventDefault();
    game?.close();
    game = new GameConnection({
      onOpen: (connection) => {
        connection.send({ type: "lookup", pin });
      },
      // En solo, il n'y a pas d'équipe à choisir : le joueur rejoint aussitôt.
      onGameInfo: (connection, { mode }) => {
        if (mode === "solo") connection.send({ type: "join", nickname });
      },
      onWelcome: (token) => {
        sessionStorage.setItem(TOKEN_KEY, token);
      },
      onError: forgetSession,
    });
  }

  function join(team: TeamChoice) {
    game?.send({ type: "join", nickname, team });
  }

  function createTeam(event: SubmitEvent) {
    event.preventDefault();
    join({ create: teamName });
  }

  function answer(choiceIndex: number) {
    const stage = view?.stage;
    if (stage?.phase === "question") game?.send({ type: "answer", questionId: stage.question.questionId, choiceIndex });
  }

  const ordinal = (rank: number, feminine: boolean) => (rank === 1 ? (feminine ? "1re" : "1er") : `${String(rank)}e`);
</script>

<main>
  {#if game?.status === "kicked"}
    <p class="screen">{errorMessage("kicked")}</p>
  {:else if view}
    {@const stage = view.stage}
    {@const teams = view.mode === "teams"}
    {@const captain = view.team.captain === view.nickname}
    {#if game?.status === "reconnecting"}<p class="banner" role="status">Connexion perdue, reconnexion…</p>{/if}
    <header>
      <p class="me">
        <strong>{view.nickname}</strong>
        {#if teams}· {view.team.name}{#if captain} (capitaine){/if}{/if}
      </p>
      {#if stage.phase === "question"}<Countdown deadline={stage.question.deadline} offset={game?.clockOffset ?? 0} />{/if}
    </header>

    {#if stage.phase === "lobby"}
      <p class="screen">C'est bon, tu es dans la partie ! Regarde l'écran : ça va commencer.</p>
      {#if teams}
        <p class="score">
          {captain ? "Tu es capitaine : c'est toi qui réponds pour l'équipe." : `${view.team.captain} répond pour l'équipe.`}
        </p>
      {/if}
    {:else if stage.phase === "question"}
      <!-- L'ordre propre à ce téléphone : formes et couleurs suivent la position, pas la réponse. -->
      {@const choices = playerChoices(stage.question.choices, `${stage.question.questionId}:${view.nickname}`)}
      {#if !captain}
        <p class="text">{stage.question.text}</p>
        <ul class="answers">
          {#each choices as { index, text }, position (index)}
            {@const picked = stage.teamAnswer === index}
            <li style:--color="var(--choice-{position})" class={{ picked, faded: stage.teamAnswer !== undefined && !picked }}>
              <ChoiceShape index={position} size="2.5rem" />
              <span>{text}</span>
              {#if picked}<strong class="pick">Choix de l'équipe</strong>{/if}
            </li>
          {/each}
        </ul>
        <p class="score">
          {view.team.captain}
          {stage.teamAnswer === undefined ? "répond pour l'équipe : discutez-en !" : "a répondu pour l'équipe."}
        </p>
      {:else if stage.answered}
        <p class="screen">Réponse envoyée ! Attends les autres…</p>
      {:else}
        <p class="text">{stage.question.text}</p>
        <div class="answers">
          {#each choices as { index, text }, position (index)}
            <button
              style:--color="var(--choice-{position})"
              disabled={game?.status !== "open"}
              onclick={() => {
                answer(index);
              }}
            >
              <ChoiceShape index={position} size="2.5rem" />
              <span>{text}</span>
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
      <p class="score">{teams ? "Score de l'équipe" : "Score"} : {stage.you?.score ?? 0}</p>
    {:else if stage.phase === "leaderboard"}
      <p class="screen">
        {#if stage.you}
          {teams ? "Ton équipe est" : "Tu es"} <strong>{ordinal(stage.you.rank, teams)}</strong> avec {stage.you.score} points
        {:else}Regarde le classement à l'écran{/if}
      </p>
    {:else}
      <h1>Podium</h1>
      <Standings standings={stage.podium} highlight={view.team.name} />
      <p class="score">Merci d'avoir joué !</p>
    {/if}

    {#if game?.error}<p class="error" role="alert">{errorMessage(game.error)}</p>{/if}
  {:else if game?.status === "closed"}
    <p class="screen">Connexion perdue. <button
        onclick={() => {
          location.reload();
        }}>Recharger</button
      ></p>
  {:else if visitor}
    <section class="teams">
      <h1>Choisis ton équipe</h1>
      {#if visitor.teams.length > 0}
        <ul>
          {#each visitor.teams as team (team.teamId)}
            <li>
              <button
                disabled={game?.status !== "open"}
                onclick={() => {
                  join({ join: team.teamId });
                }}>{team.name}</button
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p>Aucune équipe pour l'instant.</p>
      {/if}
      {#if visitor.canCreateTeam}
        <form onsubmit={createTeam}>
          <label>Nouvelle équipe <input bind:value={teamName} maxlength="24" required autocomplete="off" /></label>
          <button class="primary" disabled={game?.status !== "open"}>Créer l'équipe</button>
        </form>
      {/if}
      {#if game?.error}<p class="error" role="alert">{errorMessage(game.error)}</p>{/if}
    </section>
  {:else if game && !game.error}
    <p class="screen">Connexion…</p>
  {:else}
    <form onsubmit={lookup}>
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
    display: flex;
    flex-direction: column;
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

  .me {
    margin: 0;
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

  /* 2 colonnes, sur toute la hauteur restante. */
  .answers {
    display: grid;
    flex: 1;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: 1fr;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .answers button,
  .answers li {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    overflow: hidden;
    border: none;
    border-top: 0.6rem solid var(--color);
    padding: 1rem 0.75rem;
    font-size: 1.05rem;
    text-align: center;
    box-shadow: var(--shadow);
  }

  .answers button:active {
    transform: scale(0.98);
  }

  .answers li {
    border-radius: var(--radius);
    background: var(--surface);
    transition: opacity 0.3s;
  }

  .answers li.picked {
    outline: 3px solid var(--brand);
  }

  .answers li.faded {
    opacity: 0.45;
  }

  .pick {
    font-size: 0.9rem;
  }

  .teams {
    display: grid;
    gap: 1rem;
    margin-top: 10vh;
  }

  .teams h1 {
    margin: 0;
    color: var(--brand);
  }

  .teams ul {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .teams li button {
    width: 100%;
    padding-block: 0.9rem;
    font-size: 1.15rem;
  }

  .teams form {
    margin-top: 0.5rem;
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
