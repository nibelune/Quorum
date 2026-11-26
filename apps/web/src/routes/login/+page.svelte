<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";

  let mode: "sign-in" | "sign-up" = $state("sign-in");
  let name = $state("");
  let email = $state("");
  let password = $state("");
  let error = $state("");
  let pending = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    pending = true;
    error = "";
    const body = mode === "sign-in" ? { email, password } : { name, email, password };
    const response = await fetch(`/api/auth/${mode}/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    pending = false;
    if (response.ok) await goto(resolve("/dashboard"));
    else error = mode === "sign-in" ? "Email ou mot de passe incorrect." : "Impossible de créer ce compte : cet email est peut-être déjà utilisé.";
  }
</script>

<main>
  <h1>{mode === "sign-in" ? "Connexion" : "Créer un compte"}</h1>
  <form onsubmit={submit}>
    {#if mode === "sign-up"}
      <label>Nom <input bind:value={name} required autocomplete="name" /></label>
    {/if}
    <label>Email <input type="email" bind:value={email} required autocomplete="email" /></label>
    <label>
      Mot de passe
      <input
        type="password"
        bind:value={password}
        required
        minlength="8"
        autocomplete={mode === "sign-in" ? "current-password" : "new-password"}
      />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary" disabled={pending}>{mode === "sign-in" ? "Se connecter" : "Créer le compte"}</button>
  </form>
  <button class="switch" onclick={() => (mode = mode === "sign-in" ? "sign-up" : "sign-in")}>
    {mode === "sign-in" ? "Pas encore de compte ? En créer un" : "Déjà un compte ? Se connecter"}
  </button>
</main>

<style>
  main {
    display: grid;
    gap: 1rem;
    max-width: 24rem;
    margin: 10vh auto;
    padding: 2rem;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h1 {
    margin: 0;
    color: var(--brand);
  }

  form {
    display: grid;
    gap: 1rem;
  }

  .switch {
    border: none;
    background: none;
    color: var(--brand);
    text-decoration: underline;
  }
</style>
