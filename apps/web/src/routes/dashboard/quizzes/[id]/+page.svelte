<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import ChoiceShape from "$lib/ChoiceShape.svelte";
  import { api } from "$lib/api";
  import { MAX_CHOICES, Quiz, QuizInput } from "@quorum/protocol";
  import { z } from "zod";

  type DraftQuestion = QuizInput["questions"][number];

  const DURATIONS = [5, 10, 20, 30, 45, 60, 90, 120, 180, 240, 300];
  const quizId = page.params.id ?? "new";

  const multipleChoice = (): DraftQuestion => ({ text: "", choices: ["", "", "", ""], correctIndex: 0, durationSec: 20 });
  const trueFalse = (): DraftQuestion => ({ text: "", choices: ["Vrai", "Faux"], correctIndex: 0, durationSec: 20 });

  let draft: QuizInput | null = $state(null);
  let error = $state("");
  let saving = $state(false);

  if (quizId === "new") draft = { title: "", questions: [multipleChoice()] };
  else
    void api(Quiz, `/quizzes/${quizId}`).then(({ title, questions }) => {
      draft = { title, questions };
    });

  function addQuestion(question: DraftQuestion) {
    draft?.questions.push(question);
  }

  function removeQuestion(index: number) {
    draft?.questions.splice(index, 1);
  }

  function removeChoice(question: DraftQuestion, index: number) {
    question.choices.splice(index, 1);
    if (index < question.correctIndex) question.correctIndex--;
    else if (index === question.correctIndex) question.correctIndex = 0;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const parsed = QuizInput.safeParse(draft);
    if (!parsed.success) {
      error = z.prettifyError(parsed.error);
      return;
    }
    saving = true;
    try {
      if (quizId === "new") await api(Quiz, "/quizzes", { method: "POST", body: parsed.data });
      else await api(Quiz, `/quizzes/${quizId}`, { method: "PUT", body: parsed.data });
      await goto(resolve("/dashboard"));
    } catch {
      error = "L'enregistrement a échoué. Réessayez dans un instant.";
      saving = false;
    }
  }
</script>

{#if draft}
  <form onsubmit={save}>
    <div class="title">
      <h1>{quizId === "new" ? "Nouveau quiz" : "Modifier le quiz"}</h1>
      <a href={resolve("/dashboard")}>Retour à mes quiz</a>
    </div>

    <label>Titre <input bind:value={draft.title} required maxlength="120" /></label>

    {#each draft.questions as question, q (question)}
      <fieldset>
        <legend>Question {q + 1}</legend>
        <label>Énoncé <textarea bind:value={question.text} required maxlength="300" rows="2"></textarea></label>

        <ol>
          {#each question.choices, c}
            <li>
              <ChoiceShape index={c} />
              <input bind:value={question.choices[c]} aria-label="Choix {c + 1}" required maxlength="120" />
              <label class="correct">
                <input type="radio" name="correct-{q}" value={c} bind:group={question.correctIndex} />
                Bonne réponse
              </label>
              {#if question.choices.length > 2}
                <button type="button" onclick={() => {
                    removeChoice(question, c);
                  }} aria-label="Retirer le choix {c + 1}">✕</button>
              {/if}
            </li>
          {/each}
        </ol>

        <div class="row">
          {#if question.choices.length < MAX_CHOICES}
            <button type="button" onclick={() => question.choices.push("")}>Ajouter un choix</button>
          {/if}
          <label class="duration">
            Durée
            <select bind:value={question.durationSec}>
              {#each DURATIONS as duration (duration)}
                <option value={duration}>{duration} s</option>
              {/each}
            </select>
          </label>
          {#if draft.questions.length > 1}
            <button type="button" class="danger" onclick={() => {
                removeQuestion(q);
              }}>Supprimer la question</button>
          {/if}
        </div>
      </fieldset>
    {/each}

    <div class="row">
      <button type="button" onclick={() => {
          addQuestion(multipleChoice());
        }}>Ajouter un QCM</button>
      <button type="button" onclick={() => {
          addQuestion(trueFalse());
        }}>Ajouter un vrai/faux</button>
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary save" disabled={saving}>Enregistrer</button>
  </form>
{:else}
  <p>Chargement…</p>
{/if}

<style>
  form {
    display: grid;
    gap: 1.25rem;
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }

  .title a {
    font-weight: 600;
    color: var(--brand);
  }

  fieldset {
    display: grid;
    gap: 1rem;
    margin: 0;
    border: none;
    border-radius: var(--radius);
    padding: 1.25rem;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  legend {
    float: left;
    font-weight: 800;
    color: var(--brand);
  }

  ol {
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .correct {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.4rem;
    font-weight: 400;
    white-space: nowrap;
  }

  .correct input {
    width: auto;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
  }

  .duration {
    width: 8rem;
  }

  .error {
    white-space: pre-line;
  }

  .save {
    justify-self: start;
    padding-inline: 2rem;
  }
</style>
