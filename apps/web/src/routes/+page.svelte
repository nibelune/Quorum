<script lang="ts">
  import { resolve } from "$app/paths";
</script>

<main>
  <h1>Quorum</h1>
  <p>Le quiz en direct : l'animateur projette, la salle répond depuis son téléphone.</p>
  <nav>
    <a class="play" href={resolve("/play")}>Rejoindre une partie</a>
    <a href={resolve("/dashboard")}>Espace animateur</a>
  </nav>
</main>

<style>
  main {
    display: grid;
    place-content: center;
    gap: 1rem;
    min-height: 100dvh;
    padding: 2rem;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: clamp(3rem, 12vw, 6rem);
    color: var(--brand);
  }

  nav {
    display: grid;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  a {
    border: 2px solid var(--brand);
    border-radius: var(--radius);
    padding: 1rem 2rem;
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--brand);
    text-decoration: none;
  }

  a.play {
    background: var(--brand);
    color: var(--brand-ink);
  }
</style>
