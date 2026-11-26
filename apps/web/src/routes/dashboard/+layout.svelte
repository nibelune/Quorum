<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import type { Snippet } from "svelte";

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    await goto(resolve("/login"));
  }
</script>

<header>
  <a href={resolve("/dashboard")}>Quorum</a>
  <button onclick={signOut}>Se déconnecter</button>
</header>
<main>
  {@render children()}
</main>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem clamp(1rem, 4vw, 3rem);
    background: var(--brand);
  }

  header a {
    font-size: 1.4rem;
    font-weight: 800;
    color: var(--brand-ink);
    text-decoration: none;
  }

  main {
    max-width: 56rem;
    margin: 0 auto;
    padding: 2rem clamp(1rem, 4vw, 3rem);
  }
</style>
