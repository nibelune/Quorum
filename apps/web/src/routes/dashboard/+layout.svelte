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
  <a class="logo" href={resolve("/dashboard")}>Quorum</a>
  <nav>
    <a href={resolve("/dashboard")}>Mes quiz</a>
    <a href={resolve("/dashboard/games")}>Mes parties</a>
  </nav>
  <button onclick={signOut}>Se déconnecter</button>
</header>
<main>
  {@render children()}
</main>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 1rem clamp(1rem, 4vw, 3rem);
    background: var(--brand);
  }

  header a {
    font-weight: 600;
    color: var(--brand-ink);
    text-decoration: none;
  }

  header .logo {
    font-size: 1.4rem;
    font-weight: 800;
  }

  nav {
    display: flex;
    gap: 1rem;
  }

  header button {
    margin-left: auto;
  }

  main {
    max-width: 56rem;
    margin: 0 auto;
    padding: 2rem clamp(1rem, 4vw, 3rem);
  }
</style>
